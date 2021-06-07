
'use strict'

function guid() {
  function _p8(s) {
    var p = (Math.random().toString(16) + "000000000").substr(2, 8);
    return s ? "-" + p.substr(0, 4) + "-" + p.substr(4, 4) : p;
  }
  return _p8() + _p8(true) + _p8(true) + _p8();
}

class WalletController {
  /**
   * Lamden Wallet Controller Class
   *
   * This Class interfaces with the Lamden Wallet's content script. It provids helper methods for creating a connection,
   * getting wallet info, sending transactions and retreiving tx information.
   *
   * The connection information for your DAPP can be supplied now or later by calling "sendConnection" manually.
   *
   * IMPORTANT: The window object needs to be available when creating this instance as it will attempt to create listeners.
   *
   *
   * @param {Object|undefined} connectionRequest  A connection request object
   * @param {string} connectionRequest.appName The name of your dApp
   * @param {string} connectionRequest.version Connection version. Older version will be over-written in the uers's wallet.
   * @param {string} connectionRequest.contractName The smart contract your DAPP will transact to
   * @param {string} connectionRequest.networkType Which Lamden network the approval is for (mainnet or testnet) are the only options
   * @param {string} connectionRequest.logo The reletive path of an image on your webserver to use as a logo for your Lamden Wallet Linked Account
   * @param {string=} connectionRequest.background The reletive path of an image on your webserver to use as a background for your Lamden Wallet Linked Account
   * @param {string=} connectionRequest.charms.name Charm name
   * @param {string=} connectionRequest.charms.variableName Smart contract variable to pull data from
   * @param {string=} connectionRequest.charms.key Key assoicated to the value you want to lookup
   * @param {string=} connectionRequest.charms.formatAs What format the data is
   * @param {string=} connectionRequest.charms.iconPath An icon to display along with your charm
   * @fires newInfo
   * @return {WalletController}
   */
  constructor(connectionRequest = undefined) {
    this.connectionRequest = connectionRequest ? new WalletConnectionRequest(connectionRequest) : null;
    this.events = new MyEventEmitter();
    this.installed = null;
    this.locked = null;
    this.approvals = {};
    this.approved = false;
    this.autoTransactions = false;
    this.walletAddress = ""
    this.callbacks = {};

    document.addEventListener('lamdenWalletInfo', (e) => {
      this.installed = true;
      let data = e.detail;

      if (data) {
        if (!data.errors) {
          if (typeof data.locked !== 'undefined') this.locked = data.locked

          if (data.wallets.length > 0) this.walletAddress = data.wallets[0]
          if (typeof data.approvals !== 'undefined') {
            this.approvals = data.approvals
            let approval = this.approvals[this.connectionRequest?.networkType]
            if (approval) {
              if (approval.contractName === this.connectionRequest.contractName) {
                this.approved = true;
                this.autoTransactions = approval.trustedApp
              }
            }
          }
        } else {
          data.errors.forEach(err => {
            if (err === "Wallet is Locked") {
              this.locked = true;
            }

          })
        }
        this.events.emit('newInfo', e.detail)
      }
    }, { once: true })
    document.addEventListener('lamdenWalletTxStatus', (e) => {
      let txResult = e.detail.data
      if (txResult.errors) {
        if (txResult.errors.length > 0) {
          let uid = txResult?.txData?.uid
          if (txResult.status === "Transaction Cancelled") {
            let txData = JSON.parse(txResult.rejected)
            uid = txData.uid
          }
          if (this.callbacks[uid]) this.callbacks[uid](e.detail)
        }
      } else {
        if (Object.keys(txResult.txBlockResult).length > 0) {
          if (this.callbacks[txResult.uid]) this.callbacks[txResult.uid](e.detail);
        }
      }
      this.events.emit('txStatus', e.detail)
    })
  }
  /**
   * Creates a "lamdenWalletGetInfo" CustomEvent to ask the Lamden Wallet for the current information.
   * This will fire the "newInfo" events.on event
   *
   * @fires newInfo
   */
  getInfo() {
    document.dispatchEvent(new CustomEvent('lamdenWalletGetInfo'));
  }
  /**
   * Check if the Lamden Wallet extention is installed in the user's broswer.
   *
   * This will fire the "newInfo" events.on event
   * @fires newInfo
   * @return {Promise} Wallet is Installed.
   */
  walletIsInstalled() {
    return new Promise((resolve, reject) => {
      const handleWalletInstalled = async (e) => {
        this.installed = true;
        this.events.emit('installed', true)
        document.removeEventListener("lamdenWalletInfo", handleWalletInstalled);
        resolve(true);
      }
      document.addEventListener('lamdenWalletInfo', handleWalletInstalled, { once: true })
      this.getInfo();
      setTimeout(() => {
        if (!this.installed) resolve(false);
      }, 1000)
    })
  }
  async connectLamdenWallet() {
    if (this.connectionRequest !== null) {
      await this.sendConnection().then(data => {
        if (data.errors) {
          if (data.errors[0] === 'Wallet is Locked') {

            document.dispatchEvent(new CustomEvent('lamdenWalletLocked'));
            this.locked = true;
          }
          if (data.errors[0] === 'User rejected connection request') {

            document.dispatchEvent(new CustomEvent('lamdenContractNotApproved'));

          }
        }
        else {
          document.dispatchEvent(new CustomEvent('lamdenContractApproved'));
          document.dispatchEvent(new CustomEvent('lamdenWalletInfo'))
        }
      })
    }
  }
  /**
   * Store connectionRequest information but don't sent
   * If the connectionRequest object wasn't supplied to the construtor then it can be supplied or updated here
   *
   * @param {Object} connectionRequest  A connection request object
   * @return {undefined}
   */
  storeConnectionRequest(connectionRequest) {
    if (!connectionRequest) throw new Error("no connection request provided")
    this.connectionRequest = new WalletConnectionRequest(connectionRequest)
  }
  /**
   * Send a connection to the Lamden Wallet for approval.
   * If the connectionRequest object wasn't supplied to the construtor then it must be supplied here.
   *
   * This will fire the "newInfo" events.on event
   * @param {Object|undefined} connectionRequest  A connection request object
   * @param {string} connectionRequest.appName The name of your dApp
   * @param {string} connectionRequest.version Connection version. Older version will be over-written in the uers's wallet.
   * @param {string} connectionRequest.contractName The smart contract your dApp will transact through
   * @param {string} connectionRequest.networkType Which Lamden network the approval is for (Mainnet or testnet)
   * @param {string=} connectionRequest.background A reletive path to an image to override the default lamden wallet account background
   * @param {string} connectionRequest.logo A reletive path to an image to use as a logo in the Lamden Wallet
   * @param {string=} connectionRequest.charms.name Charm name
   * @param {string=} connectionRequest.charms.variableName Smart contract variable to pull data from
   * @param {string=} connectionRequest.charms.key Key assoicated to the value you want to lookup
   * @param {string=} connectionRequest.charms.formatAs What format the data is
   * @param {string=} connectionRequest.charms.iconPath An icon to display along with your charm
   * @fires newInfo
   * @return {Promise} The User's Lamden Wallet Account details or errors from the wallet
   */
  sendConnection(connectionRequest = undefined) {
    if (connectionRequest) this.connectionRequest = new WalletConnectionRequest(connectionRequest)
    if (this.connectionRequest === null) throw new Error('No connetionRequest information.')
    return new Promise((resolve) => {
      const handleConnecionResponse = (e) => {
        this.events.emit('newInfo', e.detail)
        resolve(e.detail);
        document.removeEventListener("lamdenWalletInfo", handleConnecionResponse);
      }
      document.addEventListener('lamdenWalletInfo', handleConnecionResponse, { once: true })
      document.dispatchEvent(new CustomEvent('lamdenWalletConnect', { detail: this.connectionRequest.getInfo() }));
    })
  }
  handleLockedWallet = () => {
    document.removeEventListener('lamdenWalletLocked', this.handleLockedWallet)
  }
  /**
   * Creates a "lamdenWalletSendTx" event to send a transaction request to the Lamden Wallet.
   * If a callback is specified here then it will be called with the transaction result.
   *
   * This will fire the "txStatus" events.on event
   * @param {Object} tx  A connection request object
   * @param {string} tx.networkType Which Lamden network the tx is for (Mainnet or testnet)
   * @param {string} tx.stampLimit The max Stamps this tx is allowed to use. Cannot be more but can be less.
   * @param {string} tx.methodName The method on your approved smart contract to call
   * @param {Object} tx.kwargs A keyword object to supply arguments to your method
   * @param {Function=} callback A function that will called and passed the tx results.
   * @fires txStatus
   */
  sendTransaction(tx, callback = undefined) {

    tx.uid = new Date().toISOString()
    if (typeof callback === 'function') this.callbacks[tx.uid] = callback
    document.dispatchEvent(new CustomEvent('lamdenWalletSendTx', { detail: JSON.stringify(tx) }));
  }
}

class WalletConnectionRequest {
  /**
   * Wallet Connection Request Class
   *
   * Validates and stores the information from a connectionRequest object.  See WalletController constructor for connection request params.
   * @param {Object} connectionRequest  - request object
   * @return {WalletConnectionRequest}
   */
  constructor(connectionRequest = {}) {
    const isUndefined = (value) => typeof value === "undefined";
    const populate = (request) => {
      Object.keys(request).forEach(p => {
        if (!isUndefined(this[p])) this[p] = request[p]
      })
    }
    this.request = connectionRequest
    this.appName = "";
    this.version = "";
    this.contractName = "";
    this.networkType = "";
    this.logo = "";
    this.background = "";
    this.charms = []
    try {
      populate(connectionRequest)
    } catch (e) {
      console.log(e)
      throw new Error(e.message)
    }
  }
  /**
   * Get a JSON string of the approval request information
   * @return {string} - JSON string of all request information
   */
  getInfo() {
    let info = {
      appName: this.appName,
      version: this.version,
      contractName: this.contractName,
      networkType: this.networkType, logo: this.logo
    }
    if (this.background.length > 0) info.background = this.background
    if (this.charms.length > 0) info.charms = this.charms
    return JSON.stringify(info)
  }
}


class MyEventEmitter {
  constructor() {
    this._events = {};
  }

  on(name, listener) {
    if (!this._events[name]) {
      this._events[name] = [];
    }

    this._events[name].push(listener);
  }

  removeListener(name, listenerToRemove) {
    if (!this._events[name]) {
      return
    }

    const filterListeners = (listener) => listener !== listenerToRemove;

    this._events[name] = this._events[name].filter(filterListeners);
  }


  emit(name, data) {
    if (!this._events[name]) {
      return
    }

    const fireCallbacks = (callback) => {
      callback(data);
    };

    this._events[name].forEach(fireCallbacks);
  }
}


// For contract info e.g etherscan link in image above, use TauHQ - 
// https://tauhq.com/contracts/con_simple_staking_tau_rswp_001 and https://www.tauhq.com/addresses/con_simple_staking_tau_rswp_001

let lamdenWalletInstallLink = 'https://docs.lamden.io/docs/wallet/installation/#:~:text=Chrome%20Installation%20Steps,in%20the%20Chrome%20Web%20Store.&text=In%20the%20top%20right%20hand,logo%20to%20launch%20the%20wallet.'

function addTableRow(row, head) {
  let td;
  let entry;
  let marketTableBlackList = new Set(['Bid', 'Ask', 'base_supply', 'TimeStamp', 'High', 'Low', 'MarketName', 'PrevDay', 'BaseVolume', 'PercentPriceIncrease_24h', 'token_attached', 'marketcap_tau'])
  Object.keys(row).map(r => {
    if (!marketTableBlackList.has(r)) {
      if (head) {
        entry = r;
        if (r == 'contract_name') {
          td = `<td class="centered" style="font-weight:bold">${entry}</td>`
        }
        else {
          td = td + `<td style="font-weight:bold">${entry}</td>`

        }
      }
      else {
        entry = row[r]
        if (r == 'contract_name') {
          td = `<td class="centered">${entry}</td>`
        }
        else {
          if (parseFloat(entry)) {
            entry = parseFloat(entry).toFixed(3)
          }
          td = td + `<td>${entry}</td>`

        }
      }
    }

  })
  if (head) return `<tr>${td}</tr>`
  else return `<tr>${td}</tr>`


}

function drawTable(data, tableRows) {
  if (tableRows) {
    tableRows = tableRows + addTableRow(data, false)
  }
  else {
    tableRows = addTableRow(data, true)
    tableRows = tableRows + addTableRow(data, false)

  }
  return tableRows
}

let lamdenWalletAddress;

class LamdenService {
  constructor(contract) {
    this.callback;
    this.connected;
    this.status;
    this.error;
    this.init = async () => {
      await this.locate_wallet()
    }

    this.locked = false;
    this.walletReady = false;
    document.addEventListener('lamdenWalletLocked', () => {
      this.locked = true;
    }, { once: true })
    this.contractApproved;
    document.addEventListener('lamdenContractNotApproved', () => {
      this.contractApproved = false;
    }, { once: true })

    document.addEventListener('lamdenContractApproved', () => {
      this.contractApproved = true;
    }, { once: true })
    this.contract = contract;
    this.connectionRequest = {
      appName: this.contract, // Your DAPPS's name
      logo: 'null',
      version: '0.1',
      contractName: this.contract, // Will never change
      networkType: 'mainnet', // other option is 'mainnet'
    };
    this.lwc = new WalletController(this.connectionRequest)

  }

  update_contract = function (contract) {
    let connectionRequest = {
      appName: contract, // Your DAPPS's name
      logo: 'null',
      version: '0.1',
      contractName: contract, // Will never change
      networkType: 'mainnet', // other option is 'mainnet'
    };
    this.lwc = new WalletController(connectionRequest)
  }



  locate_wallet = async function () {
    await this.lwc.walletIsInstalled().then(installed => {
      if (installed) {
        if (!this.locked) {
          this.connected = true;
          // localStorage.setItem('lamdenWallet', wallet)
        }
        else {
          this.connected = true;
        }
      }
      else {
        this.connected = false;
        this.status = 'Not Installed'
      }
    })
  }

  connect_wallet = async function (callback) {
    await this.lwc.connectLamdenWallet()
    let contract_error_message = document.createElement("b");
    contract_error_message.innerHTML = "ACCOUNT LINK WAS NOT APPROVED";
    var br = document.createElement("br");
    let contract_resolution_message = document.createTextNode('Please approve to continue...')
    if (this.locked) {
      _print_bold('\nWALLET IS LOCKED')
      _print('Please unlock your wallet and refresh...')
    }
    else {
      this.walletReady = true
      if (this.contractApproved) {

        showLoading()
        document.getElementById("connect_lamdenwallet_button").remove()
        if (this.error) {
          contract_error_message.remove();
          br.remove()
          contract_resolution_message.remove()
        }
        start(callback)
      }
      if (!this.contractApproved) {
        if (!this.error) {
          document.body.appendChild(contract_error_message)
          document.body.appendChild(br);
          document.body.appendChild(contract_resolution_message)
          this.error = true
        }
      }
    }
  }

}

const init_lamden = function (callback) {
  logger = document.getElementById('log')
  _print(new Date().toString())
  return initializeLamdenService(callback)
}

let Connector;

class RocketSwapAPI {

  constructor(address) {
    this.address = address
    this.baseURL = 'https://rocketswap.exchange:2053/api'
    this.Endpoints = {
      'balances': '/balances/',
      'marketCap': '/marketcaps',
      'marketData': '/get_market_summaries',
      'userPoolINFO': '/user_lp_balance/',
      'userStakingINFO': '/user_staking_info/',
      'stakingMeta': '/staking_meta',
      'tauPrice': '/tau_last_price'
    }
    this.opts = {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    }

  }

  getBalances = async function () {
    let url = this.baseURL + this.Endpoints.balances + this.address
    const res = await fetch(url, this.opts);
    const user_res = await res.json();
    return user_res
  }

  showBalances = async function (token_list_data, lastTauPrice, account_value_tau, account_value_usd) {
    let walletData = await this.getBalances()
    let user_stake = await this.getUserStaking();
    let tau_staked;
    let rswp_staked;
    try {
      tau_staked = user_stake.con_simple_staking_tau_rswp_001.yield_info.total_staked
    }
    catch {
      tau_staked = null
    }
    try {
      rswp_staked = user_stake.con_staking_rswp_rswp.yield_info.total_staked
    }
    catch {
      rswp_staked = null
    }
    let token_list = walletData.balances
    let tokens = Object.keys(token_list)
    let tauPrice = parseFloat(lastTauPrice).toFixed(2)
    _print('\n|-- USER WALLET BALANCES --|    * * * Asterisk designates coin being staked * * *\n'.bold())
    var walletINFO = new Array();
    let table;
    let usd_value;
    let tau_value;
    let total_usd = 0
    let total_tau = 0
    let balance;
    tokens.map(token => {
      let token_amount;
      if (token == 'currency' || token == 'con_staking_rswp_rswp') {
        //token = 'tau'

        token_amount = parseFloat(token_list[token]).toFixed(4)
        // contract_name, token_amount, token_price, usd_value, tau_value
        let token_tau_value;
        if (token == 'con_staking_rswp_rswp') {
          usd_value = (token_amount * token_list_data['con_rswp_lst001'].Last.toFixed(2)) * tauPrice
          token_tau_value = token_list_data['con_rswp_lst001'].Last
          tau_value = token_amount * token_tau_value
          token = token + '*'.bold()
        }
        else {
          usd_value = token_amount * tauPrice
          token_tau_value = 'null'
          tau_value = token_amount
        }
        if (token == 'currency') {
          token = token + ' [ TAU ]'
        }
        balance = { 'contract_name': token, 'token_amount': token_amount, 'token_tau_value': token_tau_value, 'tau_value': tau_value, 'token_price': tauPrice, 'usd_value': usd_value.toFixed(2) }
      }
      else {
        token_amount = parseFloat(token_list[token]).toFixed(4)
        tau_value = token_list_data[token].Last.toFixed(2) * token_amount
        usd_value = tau_value * tauPrice
        balance = { 'contract_name': token, 'token_amount': token_amount, 'token_tau_value': token_list_data[token].Last, 'tau_value': tau_value.toFixed(2), 'token_price': token_list_data[token].Last * tauPrice, 'usd_value': usd_value.toFixed(2) }
      }



      table = drawTable(balance, table)
      walletINFO.push(balance)
      total_tau = parseFloat(total_tau) + parseFloat(tau_value)
      total_usd = total_usd + usd_value
    })


    if (tau_staked) {
      balance = { 'contract_name': 'currency [ TAU ]*', 'token_amount': tau_staked, 'token_tau_value': 1.0, 'tau_value': tau_staked, 'token_price': 'null', 'usd_value': tau_staked * tauPrice }
      table = drawTable(balance, table)
    }

    logger.innerHTML += `<table><tbody>${table}</tbody></table>`


    let user_staking = function (tau_staked, rswp_staked) {
      let value_string = ''
      let userStaking;
      let tauStaking = false;
      let rswpStaking = false;
      if (tau_staked && rswp_staked) {
        value_string = `${tau_staked} ${'TAU'.bold()} || ${rswp_staked} ${'RSWP'.bold()}`
        userStaking = true;
        tauStaking = true;
        rswpStaking = true;
      }
      else {
        if (tau_staked) {
          value_string = `${tau_staked} ${'TAU'.bold()}`
          userStaking = true;
          tauStaking = true;
        }
        if (rswp_staked) {
          value_string = `${rswp_staked} ${'RSWP'.bold()}`
          userStaking = true;
          rswpStaking = true;
        }
      }
      if (userStaking) {
        value_string = `User Staking: ${value_string}`

      }
      if (!tauStaking) {
        tau_staked = 0
      }
      if (!rswpStaking) {
        rswp_staked = 0
      }


      let values = {
        'string': value_string,
        'tau': tau_staked,
        'rswp': rswp_staked
      }

      return values

    }

    function returnStakedAmount(tau_staked, rswp_staked, isTau) {
      let staked = 0
      if (isTau) {
        if (tau_staked) {
          staked = staked + tau_staked
        }
      }
      else {
        if (rswp_staked) {
          staked = staked + rswp_staked
        }
      }
      return staked
    }


    _print_bold('\n#####################################\n')
    let stake_string = user_staking(tau_staked, rswp_staked)
    let wallet_string = `\nWallet USD Value: $ ${account_value_usd}\nWallet TAU Value: \u25C8 ${account_value_tau}`
    let total_string = `\n\nTotal USD Value: $ ${total_usd + (returnStakedAmount(tau_staked, rswp_staked, true) * tauPrice)}\nTotal TAU Value: \u25C8 ${total_tau + (returnStakedAmount(tau_staked, rswp_staked, false))}`
    _print(stake_string.string + wallet_string + total_string)

    _print_bold('\n#####################################\n')

  }

  getLPBalances = async function () {
    let url = this.baseURL + this.Endpoints.userPoolINFO + this.address
    const res = await fetch(url, this.opts);
    let pool;
    try {
      pool = await res.json();
    }
    catch {
      pool = null
    }

    return pool
  }

  getUserStaking = async function () {
    let url = this.baseURL + this.Endpoints.userStakingINFO + this.address
    console.log(url)
    const res = await fetch(url, this.opts);
    const staking = await res.json();
    return staking
  }

  getTauPrice = async function () {
    let url = this.baseURL + this.Endpoints.tauPrice
    const res = await fetch(url, this.opts);
    const tauPrice = await res.json();
    return tauPrice
  }

  getTokenPrice = async function () {
    let url = this.baseURL + this.Endpoints.tokenPrice
    const res = await fetch(url, this.opts);
    const tokenPrices = await res.json();
    return tokenPrices
  }

  getStakingMeta = async function () {
    let url = this.baseURL + this.Endpoints.stakingMeta
    const res = await fetch(url, this.opts);
    const stakingMeta = await res.json();
    return stakingMeta
  }

  getMarketData = async function () {
    let url = this.baseURL + this.Endpoints.marketData
    const res = await fetch(url, this.opts);
    const marketData = await res.json();
    return marketData
  }

  getMarketCap = async function () {
    let url = this.baseURL + this.Endpoints.marketCap
    const res = await fetch(url, this.opts);
    const marketData = await res.json();
    return marketData
  }

}

class RocketSwapTradeCenter {
  constructor(lwc, userWallet, token_list, menu_controller, menu_uuids, menu_options) {
    // print loading trade contract
    // show loading
    this.connector = lwc
    this.token_list = token_list
    this.contract_name = "con_rocketswap_official_v1_1"
    this.userWallet = userWallet.balances
    this.vk = userWallet.vk
    this.menu_controller = menu_controller
    this.menu_uuids = menu_uuids
    this.menu_options = menu_options
  }

  _execute_trade = async function (trade_contract, amount, method) {
    let vk = this.vk;

    let txInfo = {
      vk,
      'contractName': this.contract_name,
      'methodName': method,
      'kwargs': {  // the method arguements
        contract: trade_contract,
        currency_amount: parseFloat(amount),
        minimum_received: parseFloat(amount - .5),
        token_fees: false
      },
      'networkType': 'mainnet',
      'stampLimit': 100, //Max stamps to be used. Could use less, won't use more.
    }

    _print(`\nexecuting ${trade_contract} ${method} order -- (${amount})`)

    let url = `https://rocketswap.exchange:2053/api/get_trade_history?vk=${vk}&contract_name=${trade_contract}`
    const res = await fetch(url, this.opts);
    const user_current_trades = await res.json();
    const handleResults = async (txResults) => {
      hideLoading()
      await this._trade_resolver(txResults, user_current_trades.length)
      this.menu_controller(null, this.menu_uuids, this.menu_options)


    }
    await this.connector.lwc.sendTransaction(txInfo, handleResults) // callback is optional
    window.scrollTo(0, document.body.scrollHeight);
    _print('\nawaiting transaction result...')
    showLoading()

  }

  _load_rswp_contract = function () {
    this.connector.update_contract(this.contract_name)

  }

  _enter_trade_info = function (token, sellable) {
    let method_title = '\nOrder type:\n\n'
    let checked = true
    let sell_option = ''
    if (sellable) {
      checked = false
      sell_option = '\n<input type="radio" id="sell_method" name="method" value="sell"><label for="sell_method"> Sell </label>\n'
    }
    let buy_option = `\n<input type="radio" id="buy_method" name="method" value="buy"><label for="buy_method" checked=${checked}> Buy </label>\n`
    let amount_title = '\n\nEnter token amount:\n'
    let amount_input = '\n<input type="number" min="0" id="token_amount" value="">\n'
    let trade_menu = method_title + buy_option + sell_option + amount_title + amount_input
    _print('\n\n\n####################################################\n')
    _print_bold(`\n܍†܍†܍† enter ${token} order details †܍†܍†܍\n`)
    logger.innerHTML += `<form>${trade_menu}</form>`


    let method;
    let token_amount;
    let error;
    _print_link('\n\n[Confirm Trade]'.bold(), () => {
      let buy = document.getElementById('buy_method').checked;
      let valid_trade;
      let sell = false;
      if (!checked) {
        sell = document.getElementById('sell_method').checked
      }

      token_amount = document.getElementById('token_amount').value
      if (!buy && !sell) {
        _print('')
      }
      else {

        if (buy) {
          method = 'buy'
        }
        if (sell) {
          method = 'sell'
        }
        if (token_amount > 0) {
          valid_trade = this.trade_validator(token, token_amount, sellable, method);
          if (valid_trade) {
            _print('\n\n\n####################################################\n')
            _print_bold(`\n܍†܍†܍† ${token} order †܍†܍†܍\n`)

            _print_bold('\n\n|-- NEW ORDER --|\n')

            _print(`\ncontract: ${token} \n\ntype: ${method} \n\namount: ${token_amount}`.bold())

            _print_link('\n[ EXECUTE TRADE ]', async () => {
              await this._execute_trade(token, token_amount, method)
              
            }, `execute_trade_${guid()}`)
            _print_link('\n[ EDIT TRADE ]', () => {
              this._enter_trade_info(token, sellable)
            }, `edit_trade_${guid()}`)
            _print_link('\n[ CANCEL TRADE ]', () => {
              this.load_trade_menu()
              _print('\n\n\n####################################################\n\n')
              this.menu_controller(null, this.menu_uuids, this.menu_options)
            }, `cancel_trade_${guid()}`)
            _print('\n\n\n####################################################\n\n')
            this.menu_controller(null, this.menu_uuids, this.menu_options)
          }
          else {
            // show error
            if (!error) {
              _print('invalid trade entered...try again\n')
              error = true
            }
          }
        }

      }
    })
    _print('\n\n\n####################################################\n\n')

    this.menu_controller(null, this.menu_uuids, this.menu_options)



  }

  _trade_resolver = async function (txResults, prev_trades) {
    let trade_successful;

    if (txResults.status == 'success') {
      _print(`\ntxn <a href=${'https://mainnet.lamden.io/transactions/' + txResults.data.txHash} target="_blank">${txResults.data.txHash}</a> found sucessfully....`)
      trade_successful = true
    }
    else {
      if (!txResults.status == 'Transaction Cancelled') {
        _print(`\nerror sending tx --> message: ${txResults.data.resultInfo.errorInfo[0]}`)
      }
      else {
        if (txResults.data.txBlockResult.errors[0] == "Retry Attmpts 10 hit while checking for Tx Result.") {
          _print('\nerror found with tx result...checking user trade history')
          trade_successful = true
          let vk = this.vk
          let trade_contract = txResults.data.txInfo.kwargs.contract
          //let method = txResults.data.txInfo.methodName

          let url = `https://rocketswap.exchange:2053/api/get_trade_history?vk=${vk}&contract_name=${trade_contract}`
          const res = await fetch(url, this.opts);
          const user_trades = await res.json();
          _print('\nreading user trade history.....')
          if (user_trades.length > prev_trades) {
            trade_successful = true
          }
        }
        else {
          let error_message = txResults.data.resultInfo.errorInfo[0];
          _print(`\nerror sending tx --> message: ${error_message}`)
        }
      }
    }

    if (trade_successful) {
      _print('\ntrade completed....')
    }
    else {
      _print('\ntrade could not be completed...please try again')
    }

  }

  _select_token = function () {
    let tokens_availble = Object.keys(this.token_list)
    let user_holdings = Object.keys(this.userWallet)
    _print_bold(`\n\n*** | WELCOME TO THE ROCKETSWAP TRADE CENTER | ***\n`)
    _print_bold(`\nChoose token to trade:    * * * Asterisk designates coin found in wallet * * *\n`)
    let sellable = false
    tokens_availble.map(token => {
      if (parseFloat(this.token_list[token].Volume) > 0) {
        let asterisk = '';
        if (user_holdings.includes(token)) {
          asterisk = '*'
        }
        _print_link(`\n[${token} -- ${this.token_list[token].token_symbol}]${asterisk}`, () => {
          if (asterisk == '*') {
            sellable = true
          }

          this.trade(token, sellable)

        }, `${token}_selection_${guid()}`)
      }
    })


  }

  init_trade = function () {
    this._load_rswp_contract()
  }

  load_trade_menu = async function () {
    await this._select_token()
  }

  trade = async function (token, sellable) {
    this._enter_trade_info(token, sellable)
  }

  trade_validator = function (token, token_amount, sellable, method) {
    let valid;
    let tau_available;
    let tau = this.userWallet['currency']
    if (tau > 2) {
      tau_available = true
    }
    if (sellable && method == 'sell') {
      let tokens_in_wallet = this.userWallet[token]

      if (token_amount <= tokens_in_wallet) {
        if (tau_available) {
          valid = true
        }
      }
    }
    else {
      if (tau_available && method == 'buy') {
        valid = true
      }
    }
    return valid
  }



  start = async function () {
    _print("\nreading smart contract...\n");
    showLoading();
    await this.init_trade();
    hideLoading()
    await this.load_trade_menu();
    _print('')
  }

}

class RocketSwapController {
  constructor(Connector) {
    const App = {}
    this.connector = Connector;
    this.YOUR_ADDRESS = this.connector.lwc.walletAddress;
    this.trade_controller;
    this.tauPrice;
    this.rswpPrice;
    this.accountValueTau = 0;
    this.accountValueUsd = 0;
    this.userWalletData;
    this.user_balance;
    this.current_view;
    this.last_view;
    this.token_list = {}
    this.black_list = [
      'TimeStamp',
    ]
    this.show_token_info = function (token) {

      _print_bold(`\n\n${token.token_symbol} TOKEN INFO\n`)
      let table;

      table = drawTable(token, table);
      logger.innerHTML += `<table><tbody>${table}</tbody></table>`

      if (token.Volume > 0) {
        _print_link(`\n${'BUY'.bold()} ${token.token_symbol.bold()}`, async () => {
          this.trade_controller.start()
        }, `rocket_swap_buy_${token.token_symbol}_${guid()}`)
        _print_link(`${'SELL'.bold()} ${token.token_symbol.bold()}`, async () => {
          this.trade_controller.start()
        }, `rocket_swap_sell_${token.token_symbol}_${guid()}`)
      }

      _print_href(`\nVIEW ON ROCKETSWAP`, `https://rocketswap.exchange/#/swap/${token.contract_name}`)
      _print_href(`VIEW CONTRACT\n`, `https://www.tauhq.com/contracts/${token.contract_name}`)


    }
    this.token_list_uuids = new Set()
    this.menu_options = {
      'rswp_trade_center': (uuid) => {
        _print_link('[TRADE ON ROCKETSWAP]', async () => {
          const handleApprovalResults = async (txResults) => {

            if (txResults.status == 'success') {
              tradingApproved = true
              _print(`\ntxn <a href=${'https://mainnet.lamden.io/transactions/' + txResults.data.txHash} target="_blank">${txResults.data.txHash}</a> found sucessfully....`)

              _print('\ntrading is approved...loading rocketswap trade center')
              hideLoading()
            }
            else {
              if (!txResults.status == 'Transaction Cancelled') {
                _print(`\nerror sending tx --> message: ${txResults.data.resultInfo.errorInfo[0]}`)
              }
              else {
                _print(`\ntrading approval denied.....`)
              }

              _print('\nreloading start menu.....')
            }
            if (tradingApproved) {
              localStorage.setItem('rswp_trading_approval', true);
              await this.trade_controller.start()
              this.change_menu('rswp_trade')
            }
            else {
              this.change_menu(null)
            }
          }
          let tradingApproved;
          let trading_cookie = localStorage.getItem('rswp_trading_approval');
          if (trading_cookie) {
            tradingApproved = trading_cookie
          }
          else {
            tradingApproved = false
          }
          if (!tradingApproved) {
            let send_rswp_approval = {
              senderVk: this.connector.lwc.walletAddress,
              contractName: 'currency',
              methodName: 'approve',
              networkType: "mainnet",
              kwargs: {
                amount: 999999999,  // amount of TAU to approve
                to: 'con_rocketswap_official_v1_1',
              },
              stampLimit: 100, //Max stamps to be used. Could use less, won't use more.
            }
            await this.connector.lwc.sendTransaction(send_rswp_approval, handleApprovalResults) // callback is optional
            _print('\nawaiting transaction result...')
            showLoading()

          }
          else {
            await this.trade_controller.start()
            this.change_menu('rswp_trade')
          }

          window.scrollTo(0, document.body.scrollHeight);
        }, `rswp_trade_${uuid}_${guid()}`)
      },
      'token_list': (uuid) => {
        _print_link('[TOKEN LIST]', async () => {
          _print('\nloading lamden token list.....\n')
          showLoading()

          _print_bold('\n|-- LAMDEN TOKEN LIST --|\n')

          Object.keys(this.token_list).map(token => {

            _print_link(`\u2B9E ${this.token_list[token].token_symbol}`,
              () => {
                this.show_token_info(this.token_list[token]);
                this.token_list_uuids.add(`${token}_token_option`)
                this.change_menu(`${token}_token_option`)
                window.scrollTo(0, document.body.scrollHeight);
              },
              `${token}_token_option`
            )
          })
          window.scrollTo(0, document.body.scrollHeight);
          this.change_menu('token_list')
        }, `token_list_${uuid}_${guid()}`)
      },
      'rswp_pools': (uuid) => {
        _print_link('[USER POOLS]', async () => {
          _print('\nloading user pool info.....\n')
          showLoading()

          let lp_balances = await this.API.getLPBalances();
          if (lp_balances == null) {
            _print_bold('USER DOES NOT HAVE ANY LP POINTS ACCUMULATED')
          }
          else {
            _print_bold('\n|-- USER LP POINTS --|\n')
          Object.keys(lp_balances.points).map(token => {
            _print(`${token}: ${lp_balances.points[token]}`)
          })
          this.change_menu('rswp_pools')
          }
          
          window.scrollTo(0, document.body.scrollHeight);
        }, `rswp_pools_${uuid}_${guid()}`)
      },
      'user_staking': (uuid) => {
        _print_link('[USER STAKING]', async () => {
          _print('\nloading user staking info.....\n')
          showLoading()
          let staking_info = await this.API.getUserStaking();
          let staking_meta = await this.API.getStakingMeta();
          _print_bold('\n|-- USER STAKING INFO --|\n')
          function show_time(time) {
            let t = {
              'time': `\u231B ${time[3]}:${time[4]}:${time[5]}:${time[6]}`,
              'date': `\uD83D\uDDD3 ${time[1]}/${time[2]}/${time[0]}`
            }
            return t
          }
          let staking_overviews = staking_meta.ents
          let staking_contracts = staking_meta.env.split(',')
          let meta = {}
          for (let s in staking_overviews) {
            meta[staking_overviews[s].contract_name] = staking_overviews[s]
          }
          function renderCenter(name) {
            let symbolToRender = parseInt(36 - (name.length + .5)) / 2
            let center;
            let sides = function () {
              let symbols = '';
              while (symbols.length <= symbolToRender) {
                symbols = symbols + '܍†'
              }
              return symbols
            }
            center = `${sides()} ${name} ${sides()}`
            return center
          }
          let renderBorder = function (contract) {
            let border = '';
            while (border.length <= contract.length - 3) {
              border = border + '܍†'
            }
            return border
          }

          let loadStakingContract = function (contract_name, TOKENPRICE, connector, show_menu, menu_controller, user_balances) {

            _print(`\n loading ${contract_name} smart contract... \n`)

            connector.update_contract(contract_name)

            let deposit_info = staking_info[contract_name]
            let contract = deposit_info.staking_contract;
            let contract_meta = meta[contract]
            let token_price
            let token;
            let center_title = renderCenter(contract)

            _print_bold(`\n${renderBorder(center_title)}`)
            _print_bold(`${center_title}`)
            _print_bold(`${renderBorder(center_title)}\n`)
            _print(`ROI (year): ${contract_meta.ROI_yearly}%`)
            _print(`contract balance: ${contract_meta.StakedBalance}`)
            let platform;
            let alt_staking_token;
            let token_contract;
            if (contract === 'con_simple_staking_tau_rswp_001') {
              token = 'TAU'
              alt_staking_token = 'RSWP'
              token_contract = 'currency'
              platform = 'Lamden'
            }
            if (contract === 'con_staking_rswp_rswp') {
              token = 'RSWP'
              alt_staking_token = 'TAU'
              token_contract = 'con_rswp_lst001'
              platform = 'RocketSwap'
            }
            token_price = TOKENPRICE[token]
            _print(`contract value: $${parseFloat(contract_meta.StakedBalance).toFixed(2) * token_price}`)
            _print_inline(`emmission: year ${parseFloat(contract_meta.EmissionRatePerTauYearly).toFixed(2)}% hour ${parseFloat(contract_meta.EmissionRatePerHour).toFixed(2)}% second: ${parseFloat(contract_meta.EmissionRatePerSecond).toFixed(2)}%\n`)



            try {
              _print_bold('\n\n          [ deposit record ]\n')
              let amount;
              let total = 0
              let deposits = 1
              for (let d in deposit_info.deposits) {
                _print('\n╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳\n\n')
                let deposit = deposit_info.deposits[d]
                let deposit_record = show_time(deposit.time.__time__)
                _print(`date of deposit: ${deposit_record.date}`)
                _print(`time of deposit: ${deposit_record.time}`)
                amount = parseFloat(deposit.amount.__fixed__);
                total = total + amount
                _print(`amount deposited: ${amount} ${token.bold()}`)
                deposits = deposits + 1
              }
              _print('\n╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳╳\n')
              _print(`current yield: ${deposit_info.yield_info.current_yield}%`)
              _print(`you are staking: ${total} ${token.bold()} out of ${contract_meta.StakedBalance} ${token.bold()} or (${(parseFloat(total / contract_meta.StakedBalance).toFixed(4)) * 100}% of the pool) || value: $${parseFloat(total) * token_price}`)
            }
            catch {
              _print(`staking analytics: ${contract_meta.StakedBalance} ${token.bold()} being staked`)

            }
            _print_href(`Scan ${platform} Addresses`, `https://www.tauhq.com/addresses/${contract_name}`)
            _print_href('[View Contract Details]', `https://www.tauhq.com/contracts/${contract_name}`)

            let send_contract_approval = {
              senderVk: connector.lwc.walletAddress,
              contractName: 'currency',
              methodName: 'approve',
              networkType: "mainnet",
              kwargs: {
                amount: 999999999,  // amount of TAU to approve
                to: contract,
              },
              stampLimit: 100, //Max stamps to be used. Could use less, won't use more.
            }
            const staking_cookie = localStorage.getItem('tau_staking_approved');
            let contractApproved;
            if (staking_cookie) {
              staking_cookie = contractApproved
            }
            else {
              contractApproved = false
            }
            let stake = function () {
              if (contractApproved) {
                let tokens_availble = user_balances.balances[token_contract]
                _print(`${token} available for staking: ${tokens_availble}`)

                _print(`\nenter amount of ${token} you would like to stake:\n`)

                let amount_input = '\n<input type="number" min="0" id="token_amount_stake" value="">\n'

                logger.innerHTML += `${amount_input}\n`

                _print_link('[ Confirm Stake ]', () => {

                  let token_amount = document.getElementById('token_amount_stake').value
                  if (token_amount > tokens_availble) {
                    _print(`\nstaking ${token_amount} ${token_contract} to ${contract}`)
                    showLoading()
                    const txInfo = {
                      networkType: 'mainnet', // other option is 'testnet'
                      methodName: 'addStakingTokens',
                      kwargs: {
                        amount: { '__fixed__': token_amount }, //send a float
                      },
                      stampLimit: 100
                    };
                    ////////
                    const handleResults = async (txResults) => {
                      hideLoading()
                      _stake_resolver(txResults, total, token_contract)
                      window.scrollTo(0, document.body.scrollHeight);
                    }
                    connector.lwc.sendTransaction(txInfo, handleResults)
                    _print('\nawaiting transaction result...')
                    showLoading()
                  }

                  else {
                    hideLoading()
                    _print('\nnot enough tokens available to stake...')

                    show_menu(null)
                  }

                })

              }
              else {
                const handleResults = async (txResults) => {
                  hideLoading()
                  let approved = _stake_resolver(txResults, total, token_contract)
                  if (approved) {
                    localStorage.setItem('tau_staking_approved', true);
                  }
                  window.scrollTo(0, document.body.scrollHeight);
                }
                connector.lwc.sendTransaction(send_contract_approval, handleResults)
                _print('\nawaiting transaction result...')
                showLoading()
              }
            }



            let unstake = function () {
              _print(`\nunstaking ${token_contract} from ${contract}`)
              showLoading()
              if (contractApproved) {
                const txInfo = {
                  networkType: 'mainnet', // other option is 'testnet'
                  methodName: 'withdrawTokensAndYield',
                  stampLimit: 100
                };
                const handleResults = async (txResults) => {
                  hideLoading()
                  _stake_resolver(txResults, user_balances.balances[contract], token_contract)
                }
                connector.lwc.sendTransaction(txInfo, handleResults)
              }
              else {
                const handleResults = async (txResults) => {
                  hideLoading()
                  _stake_resolver(txResults, user_balances.balances[contract], token_contract)
                }
                connector.lwc.sendTransaction(send_contract_approval, handleResults)
              }
            }

            let _stake_resolver = async function (txResults, prev_stake, contract) {
              let stake_transaction;
              if (txResults.status == 'success') {
                _print(`\ntxn <a href=${'https://mainnet.lamden.io/transactions/' + txResults.data.txHash} target="_blank">${txResults.data.txHash}</a> found sucessfully....`)
                stake_transaction = true
              }
              else {
                if (!txResults.status == 'Transaction Cancelled') {
                  _print(`\nerror sending tx --> message: ${txResults.data.resultInfo.errorInfo[0]}`)
                }
                else {
                  if (txResults.data.txBlockResult.errors[0] == "Retry Attmpts 10 hit while checking for Tx Result.") {
                    _print('\nerror found with tx result...checking user stake')
                    let vk = this.YOUR_ADDRESS
                    let method = txResults.data.txInfo.methodName

                    if (method == 'addStakingTokens') {

                      let url = `https://rocketswap.exchange:2053/api/user_staking_info/${vk}`

                      const res = await fetch(url, this.opts);
                      const user_stake = await res.json();
                      _print('\nreading user staking info.....')
                      if (user_stake[contract].yield_info.total_staked > prev_stake) {
                        stake_transaction = true
                      }

                    }
                    if (method == 'withdrawTokensAndYield') {
                      let url = `https://rocketswap.exchange:2053/api/balances/${vk}`
                      const res = await fetch(url, this.opts);
                      const user_balances = await res.json();
                      _print('\nreading user balances.....')
                      if (user_balances.balances[contract] > prev_stake) {
                        stake_transaction = true
                      }
                    }



                  }
                  else {
                    let error_message = txResults.data.resultInfo.errorInfo[0];
                    _print(`\nerror sending tx --> message: ${error_message}`)
                  }
                }
              }

              if (stake_transaction) {
                _print('\ntransaction completed....')
                show_menu(null)
                return true
              }
              else {
                _print('\ntransaction could not be completed...please try again')
              }
              show_menu(null)
            }

            _print_link(`Stake [${token.bold()}]`, () => {
              stake()
              window.scrollTo(0, document.body.scrollHeight);
            }, `stake_${guid()}`)
            _print_link(`Unstake [${token.bold()}]`, () => {
              unstake()
              window.scrollTo(0, document.body.scrollHeight);
            }, `unstake_${guid()}`)
            /*
             
            _print_link(`Load [${alt_staking_token.bold()}] Contract`, () => {
              let contract_to_load;

              if (token == 'RSWP') {
                contract_to_load = 'con_simple_staking_tau_rswp_001'
              }
              else {
                contract_to_load = 'con_staking_rswp_rswp'
              }
              loadStakingContract(contract_to_load, TOKENPRICE, wallet, show_menu(`${token}-staking`), menu_controller())
              show_menu(`${token}-staking`)
              menu_controller()
            })
            
            */

            _print('\n*****************************************')


          }
          _print('Choose contract:\n')
          let TOKENPRICE = {
            'TAU': this.tauPrice,
            'RSWP': this.rswpPrice
          }
          _print_link('[1] - [TAU --> ROCKETSWAP STAKING]', () => {
            loadStakingContract('con_simple_staking_tau_rswp_001', TOKENPRICE, this.connector, this.show_menu, this.menu_controller, this.userWalletData);
            window.scrollTo(0, document.body.scrollHeight);
            this.change_menu('tau_staking')
          }, `tau_staking_${uuid}_${guid()}`)
          _print_link('[2] - [ROCKETSWAP --> ROCKETSWAP STAKING]\n', () => {
            loadStakingContract('con_staking_rswp_rswp', TOKENPRICE, this.connector, this.show_menu, this.menu_controller, this.userWalletData)
            window.scrollTo(0, document.body.scrollHeight);
            this.change_menu('rswp_staking')
          }, `rswp_staking_${uuid}_${guid()}`)

          window.scrollTo(0, document.body.scrollHeight);
        }, `user_staking_${uuid}_${guid()}`)
      },
      'user_balances': (uuid) => {
        _print_link('[USER BALANCES]', async () => {
          _print('\nloading user balances.....\n')
          showLoading()
          await this.API.showBalances(this.token_list, this.tauPrice, this.accountValueTau, this.accountValueUsd);
          this.change_menu('user_balances')

        }, `user_balances_${uuid}_${guid()}`)
      },
      'rswp_markets': (uuid) => {
        _print_link('[MARKETS]', async () => {
          _print('\nloading market data.....\n')
          showLoading()
          await this._loadMarketData();
          _print_bold('\n|-- ROCKETSWAP MARKETS --|\n')
          let table;
          Object.keys(this.token_list).map(token => {
            table = drawTable(this.token_list[token], table)
          })
          /////
          logger.innerHTML += `<table><tbody>${table}</tbody></table>`
          this.change_menu('rswp_markets')
        }, `rswp_markets_${uuid}_${guid()}`)
      }
    }
    this.menu_uuids = ['rswp_markets', 'rswp_pools', 'user_balances', 'user_staking', 'token_list', 'rswp_trade_center']

    this.show_menu = function (view, menu_uuids, menu_options) {

      _print_bold('\n|-- MENU OPTIONS --|\n')
      menu_uuids.map(option => {
        if (view == null) {
          let render_menu_option = menu_options[option]
          render_menu_option(guid())
        }
        else {
          if (option != view) {
            let render_menu_option = menu_options[option]
            render_menu_option(guid())
          }
        }


      })
      window.scrollTo(0, document.body.scrollHeight);

    }
    this.change_menu = function (new_view) {
      this.last_view = this.current_view;
      this.current_view = new_view
      if (new_view != 'home') {
        this.show_menu(new_view, this.menu_uuids, this.menu_options)
        this.menu_controller()
      }
      hideLoading()
    }
    this.menu_controller = function () {

      _print('')

      _print_link('EXIT', () => { }, `back_button_${guid()}`)
    }

    this.userStaking;
    this.tau_staked;
    this.rswp_staked;
    this.API = new RocketSwapAPI(this.YOUR_ADDRESS)
  }

  _loadMarketData = async function () {
    let marketData = await this.API.getMarketData();
    let marketCapData = await this.API.getMarketCap();

    Object.keys(marketData).map(index => {
      Object.keys(marketData[index]).map(value => {
        let token_name = marketData[index].contract_name;
        if (!this.token_list[token_name]) {
          this.token_list[token_name] = {}
        }
        this.token_list[token_name][value] = marketData[index][value]

      })

    })

    Object.keys(marketCapData).map(index => {
      Object.keys(marketCapData[index]).map(value => {
        let token_name = marketCapData[index].contract_name;
        this.token_list[token_name][value] = marketCapData[index][value]

      })

    })
  }

  showUserData = async function () {

    let user_stake = await this.API.getUserStaking();
    let user_staking = function (tau_staked, rswp_staked, rswpPrice, tauPrice) {
      let value_string = ''
      let tau_value = 0
      let rswp_value = 0

      if (rswp_staked) {
        rswp_value = ((rswpPrice * rswp_staked) * tauPrice)
      }
      if (tau_staked) {
        tau_value = (tauPrice * tau_staked)
      }
      if (tau_staked && rswp_staked) {
        value_string = `\nStake(s): $${tau_value} ${'TAU'.bold()} || $${rswp_value} ${'RSWP'.bold()}\nTotal Value of Stake(s) [${'USD'.bold()}]: $ ${tau_value + rswp_value}\nTotal Value of Stake(s) [${'TAU'.bold()}]: \u25C8 ${tau_staked + (rswp_staked * rswpPrice)}`
      }
      else {
        if (rswp_staked) {
          value_string = `$${rswp_string}`
        }
        if (tau_staked) {
          value_string = `$${tau_string}`
        }
      }

      let values = {
        'tau': tau_value,
        'rswp': rswp_value,
        'string': value_string
      }
      return values
    }

    _print_bold('\n####################################################')
    _print_bold('################## USER HOLDINGS ###################')
    _print_bold('####################################################\n')
    let tau_staked;
    let rswp_staked;
    try {
      tau_staked = user_stake.con_simple_staking_tau_rswp_001.yield_info.total_staked
    } catch {
      tau_staked = null
    }

    try {
      rswp_staked = user_stake.con_staking_rswp_rswp.yield_info.total_staked
    } catch {
      rswp_staked = null
    }


    let rswpTauPrice = this.token_list['con_rswp_lst001'].Last
    _print(`TAU Price: $ ${this.tauPrice} \nRSWP Price: $ ${this.rswpPrice}\nRSWP Tau Price: \u25C8 ${rswpTauPrice}`)

    let staked_information = user_staking(tau_staked, rswp_staked, rswpTauPrice, this.tauPrice)

    let wallet_info = `\n\nWallet USD Value: $ ${this.accountValueUsd}\nWallet TAU Value: \u25C8 ${this.accountValueTau}`

    let total_info = `\n\nTotal USD Value: $ ${this.accountValueUsd + ((staked_information.tau * this.tauPrice) + ((staked_information.rswp * rswpTauPrice) * this.tauPrice))}\nTotal TAU Value: \u25C8 ${this.accountValueTau + (staked_information.tau + staked_information.rswp)}`



    _print(staked_information.string + wallet_info + total_info)
    _print_bold('\n####################################################\n')

  }

  _loadUserData = async function (refresh) {
    let menuINFO = {
      'TAU': null,
      'RSWP': null,
      'USER_TAU': null,
      'USER_USD': null

    };

    if (refresh) {
      _print('\nfetching user data.....\n')
      let TAU = await this.API.getTauPrice();
      this.tauPrice = parseFloat(TAU.value).toFixed(4);
      await this._loadMarketData();
      this.userWalletData = await this.API.getBalances();
      this.YOUR_ADDRESS = this.userWalletData.vk;
    }
    _print('\nloading user data.....\n')

    this.rswpPrice = parseFloat(this.token_list['con_rswp_lst001'].Last).toFixed(4) * parseFloat(this.tauPrice).toFixed(4)

    Object.keys(this.userWalletData.balances).map(token => {
      let userTokenAmount = parseFloat(this.userWalletData.balances[token]);
      let tokenLastPrice;

      if (token == 'con_staking_rswp_rswp') {
        tokenLastPrice = 0
      }
      else {
        if (token == 'currency') {
          tokenLastPrice = 1.0
        }
        else {
          tokenLastPrice = parseFloat(this.token_list[token].Last)
        }

      }


      let tau_value = (userTokenAmount * tokenLastPrice)

      this.accountValueTau = this.accountValueTau + tau_value

      this.accountValueUsd = this.accountValueUsd + (tau_value * this.tauPrice)

    })

  }



  START = async function () {
    await this._loadUserData(true)

    this.trade_controller = new RocketSwapTradeCenter(this.connector, this.userWalletData, this.token_list, this.show_menu, this.menu_uuids, this.menu_options)
    _print(`\ninitialized: ${this.YOUR_ADDRESS}\n`);
    _print_bold("*** | WELCOME TO ROCKETSWAP FARMING | ***\n")
    _print("reading smart contracts...\n");
    await this.showUserData()
    this.show_menu(null, this.menu_uuids, this.menu_options)
  }

}



const initializeLamdenService = async function (callback) {

  let LamdenConnector = new LamdenService('con_simple_staking_tau_rswp_001')
  await LamdenConnector.init()

  if (LamdenConnector.connected) {
    if (!LamdenConnector.walletReady) {
      // contract_name, token_amount, token_price, usd_value, tau_value

      _print_link("\n[CONNECT WALLET]", async () => {
        Connector = LamdenConnector;
        await LamdenConnector.connect_wallet(callback)
      }, `connect_lamdenwallet_button`);
    }
    hideLoading();
  }
  else {
    _print_href('\n[INSTALL WALLET]', lamdenWalletInstallLink)
    hideLoading();

  }


}


