(function () {
  if (window.__rcBypassIframeLoaded) return;
  window.__rcBypassIframeLoaded = true;

  var PREFIX = "__rc_bypass__";
  var token = null;
  var widgetId = 0;
  var readySent = false;

  function tryExtractWidgetId() {
    var m = window.location.href.match(/[?&]widget_id=(\d+)/);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  function notifyParentReady() {
    if (readySent) return;
    readySent = true;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: PREFIX + "_iframe_ready" }, "*");
    }
  }

  function updateCheckbox(t) {
    if (!t) return;
    var cb = document.querySelector('.recaptcha-checkbox');
    if (!cb) {
      setTimeout(function () { updateCheckbox(t); }, 500);
      return;
    }

    cb.classList.remove('recaptcha-checkbox-unchecked', 'recaptcha-checkbox-loading');
    cb.classList.add('recaptcha-checkbox-checked');
    cb.setAttribute('aria-checked', 'true');

    var spinner = cb.querySelector('.recaptcha-checkbox-spinner');
    if (spinner) spinner.style.display = 'none';

    var tokenInput = document.getElementById('recaptcha-token');
    if (tokenInput) tokenInput.value = t;

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'g-recaptcha-response',
        response: t,
        widgetId: widgetId
      }, '*');
    }

    notifyParentReady();
  }

  widgetId = tryExtractWidgetId();
  notifyParentReady();

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== PREFIX + '_token') return;
    token = e.data.token;
    if (e.data.widgetId !== undefined) widgetId = e.data.widgetId;
    updateCheckbox(token);
  });
})();
