import { createPostizReader } from './postiz.mjs'

export const CHERRY_POSTIZ_INTEGRATION_ID = 'cmrb2tjm80001ow6vkzhk1yg9'

export function createCherryPostizAnalytics({ transport, clock } = {}) {
  const reader = createPostizReader({ transport, clock })
  return {
    integrationId: CHERRY_POSTIZ_INTEGRATION_ID,
    async read({ days, appId = 'cherry' } = {}) {
      if (!Number.isInteger(days) || days < 1 || days > 365 || appId !== 'cherry') throw new TypeError('Cherry analytics requires appId "cherry" and days from 1 to 365')
      return reader.readPlatformMetrics({ integrationId: CHERRY_POSTIZ_INTEGRATION_ID, days, appId, scopedIntegrationId: CHERRY_POSTIZ_INTEGRATION_ID })
    }
  }
}
