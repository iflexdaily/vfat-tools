$(function() {
    main()
  });
  
  const main = async() => {
  
    let tableData = {
      "title":"LAMDEN Network",
      "heading":["Pool Provider","LP", "Reward Tokens", "INFO"],
      "rows": [
          ["ROCKETSWAP",`<a href="rocket">Various</a>`,"RSWP","https://rocketswap.exchange/#/farm/"]
        ]
    }
  
    let table = new AsciiTable().fromJSON(tableData);
    document.getElementById('log').innerHTML += table + '<br />';
    hideLoading();
  }
  