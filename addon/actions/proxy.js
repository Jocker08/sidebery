import Actions from '../actions.js'

const BG_URL = browser.runtime.getURL('background.html')
let updateReqHandlerTimeout, incHistory = {}

async function recreateTab(tab, info, cookieStoreId) {
  await browser.tabs.create({
    windowId: tab.windowId,
    url: info.url,
    cookieStoreId,
    active: tab.active,
    pinned: tab.pinned,
  })
  browser.tabs.remove(tab.id)
}

async function checkIpInfoThroughIPIFY_ORG(cookieStoreId) {
  if (!cookieStoreId || !this.proxies[cookieStoreId]) return
  this.ipCheckCtx = cookieStoreId

  let info, result = {}

  try {
    info = await fetch('https://api.ipify.org', {
      cache: 'reload',
    }).then(res => res.text())
  } catch (err) {
    return null
  }

  if (info) result.ip = info

  return result
}

async function checkIpInfoThroughEXTREME_IP_LOOKUP_COM(cookieStoreId) {
  if (!cookieStoreId || !this.proxies[cookieStoreId]) return
  this.ipCheckCtx = cookieStoreId

  let info, result = {}

  try {
    info = await fetch('https://extreme-ip-lookup.com/json', {
      cache: 'reload',
    }).then(r => r.json())
  } catch (err) {
    return null
  }
  if (!info) return null

  if (info.status !== 'success') return null
  if (info.query) result.ip = info.query
  if (info.country) result.country = info.country

  return result
}

async function checkIpInfo(cookieStoreId) {
  let result
  result = await this.actions.checkIpInfoThroughEXTREME_IP_LOOKUP_COM(cookieStoreId)
  if (!result) {
    result = await this.actions.checkIpInfoThroughIPIFY_ORG(cookieStoreId)
  }

  return result
}

function requestHandler(info) {
  if (!this.tabsMap) return

  let tab = this.tabsMap[info.tabId]

  // Proxify requests for checking ip and other info
  if (!tab && this.ipCheckCtx && info.type === 'xmlhttprequest') {
    if (info.originUrl === BG_URL && this.proxies[this.ipCheckCtx]) {
      let ctx = this.ipCheckCtx
      this.ipCheckCtx = null
      return this.proxies[ctx]
    }
  }

  // Check hosts rules
  if (tab && info.type === 'main_frame') {
    let includedUrl

    // Include rules
    for (let rule of this.includeHostsRules) {
      let ok
      if (rule.value.test) ok = rule.value.test(info.url)
      else ok = info.url.indexOf(rule.value) !== -1

      if (!includedUrl) includedUrl = ok

      if (ok && info.cookieStoreId !== rule.ctx) {
        if (incHistory[info.cookieStoreId] === info.url) {
          incHistory[info.cookieStoreId] = null
          break
        }

        recreateTab(tab, info, rule.ctx)
        incHistory[rule.ctx] = info.url
        return
      }
    }

    // Exclude rules
    if (!includedUrl && this.excludeHostsRules[info.cookieStoreId]) {
      for (let rule of this.excludeHostsRules[info.cookieStoreId]) {
        let ok
        if (rule.test) ok = rule.test(info.url)
        else ok = info.url.indexOf(rule) !== -1

        if (ok) {
          recreateTab(tab, info)
          incHistory['firefox-default'] = info.url
          return
        }
      }
    }
  }

  // Check proxy
  if (this.proxies[info.cookieStoreId]) return this.proxies[info.cookieStoreId]
}

function updateReqHandler() {
  this.proxies = {}
  this.includeHostsRules = []
  this.excludeHostsRules = {}

  for (let ctr of Object.values(this.containers)) {
    // Proxy
    if (ctr.proxified && ctr.proxy) this.proxies[ctr.id] = { ...ctr.proxy }

    // Include rules
    if (ctr.includeHostsActive) {
      for (let rawRule of ctr.includeHosts.split('\n')) {
        let rule = rawRule.trim()
        if (!rule) continue

        if (rule[0] === '/' && rule[rule.length - 1] === '/') {
          rule = new RegExp(rule.slice(1, rule.length - 1))
        }

        this.includeHostsRules.push({ ctx: ctr.id, value: rule })
      }
    }

    // Exclude rules
    if (ctr.excludeHostsActive) {
      this.excludeHostsRules[ctr.id] = ctr.excludeHosts
        .split('\n')
        .map(r => {
          let rule = r.trim()

          if (rule[0] === '/' && rule[rule.length - 1] === '/') {
            rule = new RegExp(rule.slice(1, rule.length - 1))
          }

          return rule
        })
        .filter(r => r)
    }
  }

  // Turn on request handler
  const incRulesOk = this.includeHostsRules.length > 0
  const excRulesOk = Object.keys(this.excludeHostsRules).length > 0
  const proxyOk = Object.keys(this.proxies).length > 0

  // Update proxy badges
  if (proxyOk) {
    for (let tab of Object.values(this.tabsMap)) {
      if (this.proxies[tab.cookieStoreId] && !tab.proxified) {
        tab.proxified = true
        this.actions.showProxyBadge(tab.id)
      }
      if (!this.proxies[tab.cookieStoreId] && tab.proxified) {
        tab.proxified = false
        this.actions.hideProxyBadge(tab.id)
      }
    }
  } else {
    for (let tab of Object.values(this.tabsMap)) {
      tab.proxified = false
      this.actions.hideProxyBadge(tab.id)
    }
  }

  if (incRulesOk || excRulesOk || proxyOk) Actions.turnOnReqHandler()
  else Actions.turnOffReqHandler()
}

function updateReqHandlerDebounced() {
  if (updateReqHandlerTimeout) clearTimeout(updateReqHandlerTimeout)
  updateReqHandlerTimeout = setTimeout(() => {
    Actions.updateReqHandler()
    updateReqHandlerTimeout = null
  }, 500)
}

function turnOnReqHandler() {
  if (!browser.proxy.onRequest.hasListener(Actions.requestHandler)) {
    browser.proxy.onRequest.addListener(Actions.requestHandler, { urls: ['<all_urls>'] })
  }
}

function turnOffReqHandler() {
  if (browser.proxy.onRequest.hasListener(Actions.requestHandler)) {
    browser.proxy.onRequest.removeListener(Actions.requestHandler)
  }
}

export default {
  checkIpInfoThroughIPIFY_ORG,
  checkIpInfoThroughEXTREME_IP_LOOKUP_COM,
  checkIpInfo,
  requestHandler,
  updateReqHandler,
  updateReqHandlerDebounced,
  turnOnReqHandler,
  turnOffReqHandler,
}