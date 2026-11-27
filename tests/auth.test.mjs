import assert from 'node:assert/strict'
import test from 'node:test'
import { executeLocalSql, startAuthenticatedWorker } from './helpers/auth-worker.mjs'
import { AuthRepository, RegistrationFailure } from '../worker/src/repositories/authRepository.ts'

async function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

test('owner registration database failures expose only a fixed diagnostic stage', async () => {
  const statement = {
    bind() {
      return this
    },
    async first() {
      throw new Error('database details must not escape')
    },
  }
  const repository = new AuthRepository({ prepare: () => statement })

  await assert.rejects(
    () => repository.registerOwner({
      businessName: 'Test Business',
      currencyCode: 'INR',
      timeZone: 'Asia/Kolkata',
      username: 'test-owner',
      displayName: 'Test Owner',
      pinHash: 'hash',
      pinSalt: 'salt',
      pinIterations: 120000,
      tokenHash: 'token-hash',
      now: 1,
      expiresAt: 2,
    }),
    (error) => {
      assert.ok(error instanceof RegistrationFailure)
      assert.equal(error.stage, 'business_lookup')
      assert.equal(error.message, 'Owner registration failed')
      return true
    },
  )
})

test('PIN authentication, invitations, membership isolation, lockout, and revocation', async () => {
  const app = await startAuthenticatedWorker(8792)
  const { baseUrl, headers: ownerHeaders, persistPath } = app

  try {
    const firstSession = await fetch(`${baseUrl}/api/auth/session`, { headers: ownerHeaders })
    assert.equal(firstSession.status, 200)
    const owner = await firstSession.json()
    assert.equal(owner.memberships[0].role, 'owner')
    const rawSessionToken = decodeURIComponent(ownerHeaders.Cookie.split('=')[1])
    const storedPin = executeLocalSql(
      persistPath,
      `SELECT pin_hash FROM users WHERE username = 'owner-8792'`,
    )[0].results[0].pin_hash
    const storedSessionHash = executeLocalSql(
      persistPath,
      `SELECT token_hash FROM sessions WHERE user_id = ${owner.user.id}`,
    )[0].results[0].token_hash
    assert.notEqual(storedPin, '12345678')
    assert.notEqual(storedSessionHash, rawSessionToken)

    const duplicateRegistration = await postJson(baseUrl, '/api/auth/register', {
      bootstrapToken: 'test-bootstrap-token-with-sufficient-length',
      businessName: 'Duplicate',
      username: 'duplicate-owner',
      displayName: 'Duplicate',
      pin: '12345678',
    })
    assert.equal(duplicateRegistration.status, 409)

    const invitationResponse = await postJson(
      baseUrl,
      '/api/auth/invitations',
      { expiresInHours: 1 },
      ownerHeaders,
    )
    assert.equal(invitationResponse.status, 201)
    const invitation = await invitationResponse.json()
    const storedInviteHash = executeLocalSql(
      persistPath,
      'SELECT code_hash FROM invitation_codes ORDER BY id DESC LIMIT 1',
    )[0].results[0].code_hash
    assert.notEqual(storedInviteHash, invitation.code)

    const invalidPin = await postJson(baseUrl, '/api/auth/login', {
      username: 'owner-8792',
      pin: '87654321',
    })
    assert.equal(invalidPin.status, 401)

    const joinResponse = await postJson(baseUrl, '/api/auth/join', {
      invitationCode: invitation.code,
      username: 'member-8792',
      displayName: 'Test Member',
      pin: '87654321',
    })
    assert.equal(joinResponse.status, 201)
    const memberCookie = joinResponse.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(memberCookie)
    const memberHeaders = { Cookie: memberCookie }
    const memberCategoriesResponse = await fetch(`${baseUrl}/api/categories`, {
      headers: memberHeaders,
    })
    assert.equal(memberCategoriesResponse.status, 200)
    const fruits = (await memberCategoriesResponse.json()).categories.find(
      (category) => category.name === 'Fruits',
    )
    assert.ok(fruits)
    const memberPurchaseResponse = await postJson(baseUrl, '/api/purchases', {
      purchaseDate: '2026-11-26',
      items: [{
        newItem: {
          name: 'Member-created purchase item',
          categoryId: fruits.id,
          defaultUnit: 'kg',
        },
        amountPaise: 1200,
      }],
    }, memberHeaders)
    assert.equal(memberPurchaseResponse.status, 201)
    const memberPurchase = (await memberPurchaseResponse.json()).purchase
    const ownerView = await fetch(`${baseUrl}/api/purchases/${memberPurchase.id}`, {
      headers: ownerHeaders,
    })
    assert.equal(ownerView.status, 200)
    const memberHistory = await fetch(`${baseUrl}/api/purchases`, { headers: memberHeaders })
    assert.ok((await memberHistory.json()).purchases.some(
      (purchase) => purchase.id === memberPurchase.id,
    ))
    const memberUpdate = await fetch(`${baseUrl}/api/purchases/${memberPurchase.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...memberHeaders },
      body: JSON.stringify({
        version: memberPurchase.version,
        purchaseDate: memberPurchase.purchaseDate,
        items: [{
          itemId: memberPurchase.items[0].itemId,
          amountPaise: 1500,
        }],
      }),
    })
    assert.equal(memberUpdate.status, 200)
    const updatedMemberPurchase = (await memberUpdate.json()).purchase
    const memberDelete = await fetch(`${baseUrl}/api/purchases/${memberPurchase.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...memberHeaders },
      body: JSON.stringify({ version: updatedMemberPurchase.version }),
    })
    assert.equal(memberDelete.status, 200)

    const reusedInvitation = await postJson(baseUrl, '/api/auth/join', {
      invitationCode: invitation.code,
      username: 'another-member-8792',
      displayName: 'Another Member',
      pin: '12345678',
    })
    assert.equal(reusedInvitation.status, 400)

    const createdBusiness = await postJson(
      baseUrl,
      '/api/businesses',
      { name: 'Independent Business', currencyCode: 'INR', timeZone: 'Asia/Kolkata' },
      ownerHeaders,
    )
    assert.equal(createdBusiness.status, 201)
    const otherBusinessId = (await createdBusiness.json()).businessId
    const memberManagement = await fetch(`${baseUrl}/api/auth/members`, { headers: memberHeaders })
    assert.equal(memberManagement.status, 403)
    const crossBusiness = await postJson(
      baseUrl,
      '/api/auth/select-business',
      { businessId: otherBusinessId },
      memberHeaders,
    )
    assert.equal(crossBusiness.status, 403)
    const selectedOtherBusiness = await postJson(
      baseUrl,
      '/api/auth/select-business',
      { businessId: otherBusinessId },
      ownerHeaders,
    )
    assert.equal(selectedOtherBusiness.status, 200)
    const otherBusinessCategoriesResponse = await fetch(`${baseUrl}/api/categories`, {
      headers: ownerHeaders,
    })
    assert.equal(otherBusinessCategoriesResponse.status, 200)
    const otherBusinessCategories = (await otherBusinessCategoriesResponse.json()).categories
    const businessBFruits = otherBusinessCategories.find((category) => category.name === 'Fruits')
    assert.ok(businessBFruits)
    const businessBPurchaseResponse = await postJson(baseUrl, '/api/purchases', {
      purchaseDate: '2026-11-26',
      items: [{
        newItem: {
          name: 'Business B purchase item',
          categoryId: businessBFruits.id,
        },
        amountPaise: 2200,
      }],
    }, ownerHeaders)
    assert.equal(businessBPurchaseResponse.status, 201)
    const businessBPurchase = (await businessBPurchaseResponse.json()).purchase
    const seededCategories = await fetch(`${baseUrl}/api/categories`, { headers: ownerHeaders })
    assert.equal((await seededCategories.json()).categories.length, 6)
    const selectedOriginalBusiness = await postJson(
      baseUrl,
      '/api/auth/select-business',
      { businessId: owner.memberships[0].businessId },
      ownerHeaders,
    )
    assert.equal(selectedOriginalBusiness.status, 200)
    const crossBusinessPurchase = await fetch(
      `${baseUrl}/api/purchases/${businessBPurchase.id}`,
      { headers: memberHeaders },
    )
    assert.equal(crossBusinessPurchase.status, 404)
    const isolatedMemberHistory = await fetch(`${baseUrl}/api/purchases`, {
      headers: memberHeaders,
    })
    assert.ok(!(await isolatedMemberHistory.json()).purchases.some(
      (purchase) => purchase.id === businessBPurchase.id,
    ))

    const expiredInvitationResponse = await postJson(
      baseUrl,
      '/api/auth/invitations',
      { expiresInHours: 1 },
      ownerHeaders,
    )
    const expiredInvitation = await expiredInvitationResponse.json()
    executeLocalSql(persistPath, 'UPDATE invitation_codes SET expires_at = 0 WHERE redeemed_at IS NULL')
    const expiredJoin = await postJson(baseUrl, '/api/auth/join', {
      invitationCode: expiredInvitation.code,
      username: 'expired-member-8792',
      displayName: 'Expired Member',
      pin: '12345678',
    })
    assert.equal(expiredJoin.status, 400)

    const logoutResponse = await postJson(baseUrl, '/api/auth/logout', {}, memberHeaders)
    assert.equal(logoutResponse.status, 200)
    const memberLogin = await postJson(baseUrl, '/api/auth/login', {
      username: 'member-8792',
      pin: '87654321',
    })
    assert.equal(memberLogin.status, 200)
    const activeMemberCookie = memberLogin.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(activeMemberCookie)

    const memberList = await fetch(`${baseUrl}/api/auth/members`, { headers: ownerHeaders })
    const members = await memberList.json()
    const member = members.members.find((entry) => entry.username === 'member-8792')
    assert.ok(member)
    const deactivated = await postJson(
      baseUrl,
      `/api/auth/members/${member.userId}/deactivate`,
      {},
      ownerHeaders,
    )
    assert.equal(deactivated.status, 200)
    const revokedSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: activeMemberCookie },
    })
    assert.equal(revokedSession.status, 401)

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failedLogin = await postJson(baseUrl, '/api/auth/login', {
        username: 'owner-8792',
        pin: '87654321',
      })
      assert.equal(failedLogin.status, 401)
    }
    const rateLimited = await postJson(baseUrl, '/api/auth/login', {
      username: 'owner-8792',
      pin: '12345678',
    })
    assert.equal(rateLimited.status, 429)

    const concurrentFailures = await Promise.all(
      Array.from({ length: 10 }, () => postJson(baseUrl, '/api/auth/login', {
        username: 'burst-8792',
        pin: '87654321',
      })),
    )
    assert.equal(concurrentFailures.filter((response) => response.status === 401).length, 5)
    assert.equal(concurrentFailures.filter((response) => response.status === 429).length, 5)

    const logoutOwner = await postJson(baseUrl, '/api/auth/logout', {}, ownerHeaders)
    assert.equal(logoutOwner.status, 200)
    const revokedOwner = await fetch(`${baseUrl}/api/categories`, { headers: ownerHeaders })
    assert.equal(revokedOwner.status, 401)
  } finally {
    await app.cleanup()
  }
})
