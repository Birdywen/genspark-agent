// ArrangeMe - Fetch All Sales via browser console
// Fetches all sales records and downloads as JSON

(function() {
  var PAGE_SIZE = 100;
  var allData = [];
  var total = 0;
  var start = 0;

  function stripHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  function cleanRecord(r) {
    return {
      date: stripHtml(r.date).trim(),
      titleId: stripHtml(r.sellerTitleId).trim(),
      title: stripHtml(r.title).trim(),
      format: stripHtml(r.format).trim(),
      channel: stripHtml(r.saleChannels).trim(),
      country: stripHtml(r.countryName).trim(),
      quantity: parseInt(stripHtml(r.quantity).trim()) || 0,
      salesAmount: stripHtml(r.salesAmount).trim(),
      commissionAmount: stripHtml(r.commissionAmount).trim()
    };
  }

  function fetchPage() {
    var req = new XMLHttpRequest();
    req.open('POST', '/account/dashboardSales.action', false);
    req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    req.send('returnJson=true&sortColumnIndex=0&sortDirection=desc&start=' + start + '&length=' + PAGE_SIZE);
    var j = JSON.parse(req.responseText);
    if (j.error === 'no-session') {
      console.error('Session expired!');
      return false;
    }
    total = j.recordsTotal;
    for (var i = 0; i < j.data.length; i++) {
      allData.push(cleanRecord(j.data[i]));
    }
    console.log('Fetched ' + allData.length + ' / ' + total);
    start += PAGE_SIZE;
    return allData.length < total;
  }

  while (fetchPage()) {}
  console.log('Done! Total: ' + allData.length);

  var blob = new Blob([JSON.stringify(allData, null, 2)], {type: 'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'arrangeme_sales_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
})();
