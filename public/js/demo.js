(function () {
  'use strict';
  // The main page has a single embed; the Demo Archive stacks several, so wire
  // up each one independently (behaviour per embed is unchanged).
  var boxes = document.querySelectorAll('.demo-embed');
  if (!boxes.length) return;

  var YT_ORIGIN = 'https://www.youtube-nocookie.com';

  /*
   * When a video finishes, put the poster back with a replay glyph on it rather
   * than leaving YouTube's own end screen sitting there.
   *
   * Knowing it finished means talking to the player. The documented route is
   * YouTube's IFrame API, but that is a script served from their servers, and
   * this site runs script-src 'self' — the whole point of which is that no third
   * party can execute code here. That API is only a wrapper around a postMessage
   * conversation with the iframe, so we hold that conversation ourselves: send
   * "listening" and the player starts reporting its state. Cross-window
   * messaging isn't script execution, so the policy stays exactly as it is.
   *
   * The protocol is undocumented, so this is best-effort by design: if the
   * handshake is ever ignored, nothing breaks — the video plays out and ends on
   * YouTube's end screen, which is what happened before any of this.
   */
  Array.prototype.forEach.call(boxes, function (box) {
    var id = box.getAttribute('data-youtube');
    if (!id) return;

    var iframe = null;
    var pinger = null;
    var pings = 0;

    function stopPinging() {
      if (pinger) clearInterval(pinger);
      pinger = null;
      pings = 0;
    }

    // The player only reports once it has been asked to, and it isn't ready the
    // instant the element exists — so ask repeatedly, briefly, then give up.
    function startPinging() {
      stopPinging();
      pinger = setInterval(function () {
        if (!iframe || !iframe.contentWindow || ++pings > 24) {
          stopPinging();
          return;
        }
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
          YT_ORIGIN
        );
      }, 250);
    }

    function play() {
      if (box.classList.contains('playing')) return;
      iframe = document.createElement('iframe');
      iframe.src =
        YT_ORIGIN + '/embed/' + encodeURIComponent(id) +
        '?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=' +
        encodeURIComponent(window.location.origin);
      iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('title', 'Demo video');
      box.appendChild(iframe);
      box.classList.remove('watched');
      box.classList.add('playing');
      startPinging();
    }

    // Back to the poster, with the replay glyph where the play triangle was.
    function finished() {
      stopPinging();
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      iframe = null;
      box.classList.remove('playing');
      box.classList.add('watched');
    }

    window.addEventListener('message', function (ev) {
      if (ev.origin !== YT_ORIGIN) return;
      if (!iframe || ev.source !== iframe.contentWindow) return; // another embed's player
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        return; // not one of the player's JSON messages
      }
      if (!data) return;
      stopPinging(); // it's talking to us now
      // The state arrives two ways: as onStateChange's payload, and inside the
      // periodic infoDelivery updates. 0 is "ended".
      var state = data.event === 'onStateChange' ? data.info : data.info && data.info.playerState;
      if (state === 0) finished();
    });

    box.addEventListener('click', play);
  });
})();
