#!/usr/bin/env node
/**
 * antcpt.js — Test bout-en-bout sur le "score detector" public d'antcpt.com.
 *
 * ⚠️ RECHERCHE / ÉDUCATIF.
 *
 * antcpt.com/score_detector est un reCAPTCHA v3 STANDARD (endpoints /api2/) qui renvoie
 * PUBLIQUEMENT le score → idéal pour mesurer la qualité de notre token browserless.
 *
 *   1) génère un token pour la site key d'antcpt (action "homepage", origin antcpt.com)
 *      en faisant tourner la VM dans la VRAIE page antcpt (title/DOM/URL cohérents pour le fingerprint)
 *   2) le POST à https://antcpt.com/score_detector/verify.php
 *   3) affiche { success, score, action, hostname }
 *
 * Usage : node antcpt.js [--debug]
 */
'use strict';
const { run } = require('./field16_jsdom');

const SITE_KEY = '6LcR_okUAAAAAPYrPe-HK_0RULO1aZM15ENyM-Mf';
const ORIGIN   = 'https://antcpt.com';
const PAGE_URL = 'https://antcpt.com/score_detector/';
const ACTION   = 'homepage';
const DEBUG = process.argv.includes('--debug');

// Vraie page « Score detector for reCAPTCHA v3 » (title Idx 62, scripts Idx 57, DOM). Les libs tierces
// (jquery/vue/ua-parser/persist/bootstrap/yandex) + le <script src=api.js> sont servies à vide par le
// ResourceLoader (leurres) : la structure DOM compte pour le fingerprint, mais notre harnais reste le
// seul à piloter grecaptcha.execute.
const ANTCPT_HTML = `<!doctype html>

<html lang="en">
<head>
    <meta charset="utf-8">

    <title>Score detector for reCAPTCHA v3</title>
    <meta name="description" content="reCAPTCHA v3 score detector which shows if you are HUMAN or BOT according to Google.">
    <meta name="author" content="AntiCaptcha plugin admin">

    <meta content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=0;" name="viewport" />
    <meta name="apple-mobile-web-app-capable" content="yes" />

<!--    <link rel="stylesheet" href="css/styles.css?v=1.0">-->

    <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js"></script>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/vue/2.6.14/vue.min.js"></script>

    <script src="js/persist-min.js"></script>
    <script src="js/ua-parser.js"></script>

    <script src='https://www.google.com/recaptcha/api.js?render=6LcR_okUAAAAAPYrPe-HK_0RULO1aZM15ENyM-Mf'></script>

    <!-- Latest compiled and minified CSS -->
    <!-- https://getbootstrap.com/docs/3.3/components/ -->
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css" integrity="sha384-1q8mTJOASx8j1Au+a5WDVnPi2lkFfwwEAa8hDDdjZlpLegxhjVME1fgjWPGmkzs7" crossorigin="anonymous">
</head>

<body>
    <!-- Yandex.Metrika counter - -> <script type="text/javascript"> (function (d, w, c) { (w[c] = w[c] || []).push(function() { try { w.yaCounter40574825 = new Ya.Metrika({ id:40574825, clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true }); } catch(e) { } }); var n = d.getElementsByTagName("script")[0], s = d.createElement("script"), f = function () { n.parentNode.insertBefore(s, n); }; s.type = "text/javascript"; s.async = true; s.src = "https://mc.yandex.ru/metrika/watch.js"; if (w.opera == "[object Opera]") { d.addEventListener("DOMContentLoaded", f, false); } else { f(); } })(document, window, "yandex_metrika_callbacks"); </script> <noscript><div><img src="https://mc.yandex.ru/watch/40574825" style="position:absolute; left:-9999px;" alt="" /></div></noscript> <!-- /Yandex.Metrika counter -->

    <style>
        button {
            font-size: 12pt;
            padding: 10px;
        }
        p.important {
            font-size: 1.5em;
            font-style: italic;
        }
    </style>

    <div class="container" id="app">
        <h1>reCAPTCHA v3 score detector</h1>
        <blockquote>
            This <b>Score</b> is taken by solving the reCAPTCHA v3 on your browser.
            <br>
            The <b>Score</b> shows if Google considers you as HUMAN or BOT.
            <br>
            <i><b>1.0</b> is very likely a good interaction, <b>0.0</b> is very likely a bot</i>
            <br>
            With low score values (< <span style="color: #ff4000">0.3</span>) you'll get a slow reCAPTCHA 2,
            it would be hard to solve it.
            <br>
            And vise versa, with score >= <span style="color: #00b800">0.7</span> it will be much easier.
        </blockquote>
        <p class="important">
            On the
            <a
                    href="http://getcaptchajob.com/cqzvgt5adv"
                    target="_blank"
                    rel="nofollow"
                    title="Kolotibablo: Earn money online while solving captchas">
                        Kolotibablo.com earning money project</a>,
            you'll get paid for having the high Score!
        </p>
        <p class="text-warning">
            Current User Agent: {{ currentUserAgent }}
            <br>
            Current IP Address: {{ currentIpAddress }}
        </p>
        <div class="well">
            <div class="row">
                <div class="col-md-6">
                    <p>
                        <big
                            style="font-size: 18pt"
                            :style="{ color: scoreColor }">
                            {{ scoreMessage }}
                        </big>
                        <template v-if="scoreSuggestion">
                            <br />
                            <b>Suggestion</b>: {{ scoreSuggestion }}
                        </template>
                    </p>
                    <p v-if="countdown > 0">
                        Next check in {{ countdown }} seconds.
                    </p>
                    <button @click="refreshScore">
                        Refresh score now!
                    </button>
                    <p style="color: #ff3aaf; margin-top: 20px">
                        Too frequent checks may make worse this score.
                        It's not recommended to refresh your score often than once in 5 minutes.
                    </p>
                </div>
                <div class="col-md-6">
                    <h2>Previous score list (last 20)</h2>

                    <fieldset v-if="activeScoreTest !== null">
                        <legend>Selected Score Test:</legend>
                        <big :style="{ color: calculateScoreColor(activeScoreTest.score) }">Score: {{ activeScoreTest.score }}</big>
                        <br />
                        <big>Time: {{ activeScoreTest.time }}</big>
                        <br />
                        <big>User Agent and OS:
                            {{ getReadableUserAgent(activeScoreTest.userAgent) }}
                        </big>
                        <div class="input-group">
                            <span class="input-group-addon">Full User Agent:</span>
                            <input
                                type="text"
                                class="form-control"
                                readonly
                                placeholder="User Agent"
                                v-model="activeScoreTest.userAgent">
                        </div>
                        <div class="input-group">
                            <span class="input-group-addon">IP Address:</span>
                            <input
                                    type="text"
                                    class="form-control"
                                    readonly
                                    placeholder="IP Address"
                                    v-model="activeScoreTest.ipAddress">
                        </div>
                        <br />
                    </fieldset>

                    <button @click="clearScoreList">Clear list</button>
                    <br /><br />
                    <div class="list-group">
                        <a href="#"
                           class="list-group-item"
                           :class="{ active: activeScoreTest == scoreTest }"
                           v-for="scoreTest in scoreTestList"
                           :key="scoreTest.dateJson"
                           @click="selectFromTestList(scoreTest, $event)">

                            Score: {{ scoreTest.score }};
                            User Agent and OS: {{ getReadableUserAgent(scoreTest.userAgent) }};
                            Ip Address: {{ scoreTest.ipAddress }};
                            Google Account: {{ scoreTest.googleAccount }};
                            Time: {{ scoreTest.time }}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        var scoreTestListStore = new Persist.Store('score_detector');
        var scoreTestJson = scoreTestListStore.get('scoreTestList');
        var scoreTestList = [];
        if (scoreTestJson) {
            try {
                scoreTestList = JSON.parse(scoreTestJson);
            } catch (e) {
                scoreTestList = []
            }
        }

        var vm = new Vue({
            el: '#app',
            data: {
                currentUserAgent: getReadableUserAgent(navigator.userAgent),
                currentIpAddress: '',
                score: null,
                scoreColor: 'black',
                scoreMessage: 'Your Google reCAPTCHA 3 score will be shown here after check',
                scoreSuggestion: '',
                countdown: 2,
                scoreTestList: scoreTestList,
                activeScoreTest: null,
            },
            methods: {
                refreshScore: function() {
                    location.reload();
                    // scoreCheck();
                },
                addScoreToHistory: function (score) {
                    // console.log('parsedUA', parsedUA);

                    getMyIp(function (ipAddress) {
                        var parsedUA = UAParser(navigator.userAgent);

                        var scoreTest = {
                            score: score,
                            userAgent: navigator.userAgent,
                            parsedUA: parsedUA,
                            ipAddress: ipAddress,
                            googleAccount: '<detect google account>',
                            time: new Date().toLocaleTimeString(),
                            dateJson: new Date().toJSON(),
                        };

                        // that.scoreTestList.push(scoreTest);

                        // var scoreTestList = JSON.parse(scoreTestListStore.get('scoreTestList'));
                        scoreTestList.unshift(scoreTest);

                        while (scoreTestList.length > 20) {
                            scoreTestList.pop();
                        }
                        scoreTestListStore.set('scoreTestList', JSON.stringify(scoreTestList));
                    });

                    // getCurrentUserAgentFromIframe(function (userAgent) {
                    // });
                },
                clearScoreList: function () {
                    // same as scoreTestList = [] with keeping reference to the variable;
                    while (scoreTestList.length) {
                        scoreTestList.pop();
                    }

                    this.activeScoreTest = null;

                    scoreTestListStore.set('scoreTestList', JSON.stringify([]));
                },
                selectFromTestList: function (scoreTest, e) {
                    this.activeScoreTest = scoreTest;

                    // console.log('scoreTest', scoreTest);

                    e.preventDefault();
                },
            },
            watch: {
                countdown: function() {
                    if (this.countdown <= 0) {
                        if (this.score == null) {
                            scoreCheck();
                        } else {
                            location.reload();
                        }
                    }
                },
                score: function() {
                    if (this.score === 0) {
                        this.scoreMessage = 'Detecting score...';
                    } else if (!isNaN(this.score)) {
                        this.scoreMessage = 'Your score is: ' + this.score;

                        this.scoreColor = calculateScoreColor(this.score);

                        this.scoreSuggestion = calculateScoreSuggestion(this.score);

                        this.addScoreToHistory(this.score);
                    } else {
                        this.scoreMessage = 'And error occurred, sorry!';
                    }
                },
            },
        });

        var checkPeriod = 60;

        grecaptcha.ready(function() {
            // console.log('grecaptcha.ready');

            setInterval(function() {
                if (vm.$data.countdown > 0) {
                    vm.$data.countdown -= 1;
                }
            }, 1000);
        });

        // refresh User Agent and IP Address every 1 second
        // setInterval(function () {
            // getCurrentUserAgentFromIframe(function (userAgent) {
            //     vm.$data.currentUserAgent = getReadableUserAgent(userAgent);
            // });

            getMyIp(function (ipAddress) {
                vm.$data.currentIpAddress = ipAddress;
            });
        // }, 1000);

        var scoreCheck = function() {
            // console.log('grecaptcha execute');

            vm.$data.score = 0;

            grecaptcha
                .execute("6LcR_okUAAAAAPYrPe-HK_0RULO1aZM15ENyM-Mf", { action: 'homepage' })
                .then(function(token) {

                    // console.log('DONE EXECUTING');
                    // console.log('token', token);

                    // Verify the token on the server.
                    $.ajax(
                        'verify.php',
                        {
                            method: 'POST',
                            type: 'POST',
                            dataType: 'json',
                            contentType: 'application/json',
                            data: JSON.stringify({ 'g-recaptcha-response': token }),
                            success: function (jsonResult) {
                                // console.log('jsonResult', jsonResult);

                                // vm.$data.countdown = checkPeriod;

                                if (jsonResult.success
                                    && typeof jsonResult.score !== 'undefined') {

                                    vm.$data.score = jsonResult.score * 1;

                                } else {
                                    vm.$data.score = 'xz';
                                }
                            },
                            error: function (jqXHR, textStatus, errorThrown) {
                                // а похую!
                                vm.$data.score = 'xz';

                                vm.$data.countdown = checkPeriod;
                            }
                        }
                    );
                });
        };

        function getCurrentUserAgentFromIframe(cb) {
            var userAgentIframeId = 'currentUserAgent';
            var userAgentIframe = document.getElementById(userAgentIframeId);
            if (!userAgentIframe) {
                userAgentIframe = document.createElement('iframe');
                userAgentIframe.id = userAgentIframeId;

                userAgentIframe.width = '1px';
                userAgentIframe.height = '1px';
                userAgentIframe.src = 'writeUserAgent.html';

                userAgentIframe.onload = function () {
                    setTimeout(function () {
                        cb(userAgentIframe.contentWindow.document.body.innerText);
                        // document.body.removeChild(userAgentIframe);
                        // delete userAgentIframe;
                    }, 100);
                };

                document.body.appendChild(userAgentIframe);
            } else {
                userAgentIframe.contentWindow.location.reload();
            }

            /*
            var html =
                '<body><script>' +
                    'document.write(navigator.userAgent);' +
                '<\\/script></body>';
            iframe.src = 'data:text/html;charset=utf-8,' + encodeURI(html);
            */
        }

        function getReadableUserAgent(userAgent) {
            var parsedUA = UAParser(userAgent);
            return parsedUA.browser.name + ' ' + parsedUA.browser.version + ' for ' + parsedUA.os.name;
        }

        function getMyIp(cb) {
            // https://antcpt.com/score_detector/getMyIp.php

            $.ajax(
                'getMyIp.php',
                {
                    method: 'POST',
                    type: 'POST',
                    dataType: 'json',
                    contentType: 'application/json',
                    success: function (jsonResult) {
                        cb(typeof jsonResult.ip !== 'undefined' ? jsonResult.ip : 'unknown');
                    },
                    error: function (jqXHR, textStatus, errorThrown) {
                        cb('unknown');
                    }
                }
            );
        }

        function calculateScoreColor(score) {
            if (score >= 0.7) {
                return '#00b800';
            } else if (score >= 0.5) {
                return '#ebb11e';
            } else if (score >= 0.3) {
                return '#ff7013';
            } else {
                return '#ff4000';
            }
        }

        function calculateScoreSuggestion(score) {
            if (score >= 0.7) {
                return 'This is a good result, you can work with fast reCAPTCHA 2';
            } else if (score >= 0.5) {
                return 'That\\'s ok, you can successfully work';
            } else if (score >= 0.3) {
                return 'You need to change User Agent, Proxy Server and Google Account for better reCAPTCHA 2 performance';
            } else {
                return 'You DO NOT work with this score, it\\'s a low value, you will get a VERY SLOW reCAPTCHA 2 ' +
                    'and therefore will be banned on kolotibablo.com';
            }
        }
    </script>

<!--    <script src="js/scripts.js"></script>-->

</body>
</html>`;

async function postScore(token) {
  const res = await fetch('https://antcpt.com/score_detector/verify.php', {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'fr-FR,fr;q=0.5',
      'content-type': 'application/json',
      'origin': 'https://antcpt.com',
      'referer': 'https://antcpt.com/score_detector/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({ 'g-recaptcha-response': token }),
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; }
  catch (_) { return { status: res.status, text }; }
}

(async () => {
  console.log('1) génération du token (mode standard v3, action="' + ACTION + '", vraie page antcpt)…');
  const r = await run({
    siteKey: SITE_KEY, origin: ORIGIN, action: ACTION, hl: 'fr',
    mode: 'standard', pageHtml: ANTCPT_HTML, pageUrl: PAGE_URL,
    // Le vrai body antcpt (score 0.7) a le champ 25 = [] VIDE (auto-execute, pas de souris). On matche.
    mouse: process.env.RC_MOUSE === '1',
    quiet: !DEBUG, debug: DEBUG, timeout: 45000,
  });
  if (!r.token) {
    console.error('✖ Aucun token généré (reload HTTP ' + r.reloadStatus + '). Abandon.');
    process.exit(2);
  }
  console.log('   token : ' + r.token.slice(0, 48) + '…  (' + r.token.length + ' chars, /reload HTTP ' + r.reloadStatus + ')');

  console.log('2) POST → antcpt.com/score_detector/verify.php …');
  const v = await postScore(r.token);

  console.log('3) réponse (HTTP ' + v.status + ') :');
  console.log(JSON.stringify(v.json || v.text, null, 2));
  if (v.json && typeof v.json.score !== 'undefined') {
    console.log('\n════════════════════════════════');
    console.log('  SCORE : ' + v.json.score + '   action=' + v.json.action + '   hostname=' + v.json.hostname);
    console.log('════════════════════════════════');
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
