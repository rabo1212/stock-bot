const TelegramBot = require('node-telegram-bot-api');
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const axios = require('axios');
const Redis = require('ioredis');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN 필요'); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });

let redis = null;
if (REDIS_URL) {
  redis = new Redis(REDIS_URL);
  redis.on('connect', () => console.log('Redis 연결 성공!'));
  redis.on('error', (err) => console.error('Redis 오류:', err));
}

async function saveData(key, data) { if (redis) await redis.set(key, JSON.stringify(data)); }
async function loadData(key, def = null) { if (redis) { const d = await redis.get(key); return d ? JSON.parse(d) : def; } return def; }

async function getWatchlist(chatId) { return await loadData(`watchlist:${chatId}`, []); }
async function saveWatchlist(chatId, list) { await saveData(`watchlist:${chatId}`, list); }
async function getAlerts(chatId) { return await loadData(`alerts:${chatId}`, []); }
async function saveAlerts(chatId, list) { await saveData(`alerts:${chatId}`, list); }
async function getExchangeAlerts(chatId) { return await loadData(`exchangeAlerts:${chatId}`, []); }
async function saveExchangeAlerts(chatId, list) { await saveData(`exchangeAlerts:${chatId}`, list); }
async function getSchedules(chatId) { return await loadData(`schedules:${chatId}`, []); }
async function saveSchedules(chatId, list) { await saveData(`schedules:${chatId}`, list); }
async function loadBriefingSubscribers() { return new Set(await loadData('briefingSubs', [])); }
async function saveBriefingSubscribers(subs) { await saveData('briefingSubs', Array.from(subs)); }

const conversationHistory = {};

async function getAIResponse(chatId, userMessage) {
  if (!conversationHistory[chatId]) conversationHistory[chatId] = [];
  conversationHistory[chatId].push({ role: 'user', content: userMessage });
  if (conversationHistory[chatId].length > 20) conversationHistory[chatId] = conversationHistory[chatId].slice(-20);

  const systemPrompt = `너는 '대장미주봇'이라는 텔레그램 봇이야. 친근하고 캐주얼한 반말로 대화해.

🤖 너의 기능:
- 주식 조회: 종목명 입력하면 현재가, RSI, 52주 고저 분석
- 관심종목: "테슬라 추가" / "관심종목" / "테슬라 삭제"
- 목표가 알림: "테슬라 400 알려줘" → 도달시 알림
- 환율: "환율" / "1400원 알려줘"
- 일정 알림: "일정 금요일 19시 회의" → 10분 전 알림 (진짜 됨!)
- 뉴스 브리핑: "뉴스" / "디자인"

사용자가 기능 물어보면 자신있게 답해!
사용자는 포토그래퍼이고 AI 제품사진 촬영 사업 준비중.
답변은 짧고 간결하게!`;

  if (ANTHROPIC_API_KEY) {
    try {
      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt,
        messages: conversationHistory[chatId],
      }, { headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, timeout: 30000 });
      const msg = res.data.content[0].text;
      conversationHistory[chatId].push({ role: 'assistant', content: msg });
      return msg;
    } catch (e) { console.error('Claude 오류:', e.message); }
  }

  if (OPENAI_API_KEY) {
    try {
      const res = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, ...conversationHistory[chatId]], max_tokens: 1024,
      }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` }, timeout: 30000 });
      const msg = res.data.choices[0].message.content;
      conversationHistory[chatId].push({ role: 'assistant', content: msg });
      return msg;
    } catch (e) { console.error('OpenAI 오류:', e.message); }
  }
  return null;
}

const koreanToTicker = {
  '애플': 'AAPL', '마이크로소프트': 'MSFT', 'MS': 'MSFT', '엔비디아': 'NVDA', '아마존': 'AMZN',
  '알파벳': 'GOOGL', '구글': 'GOOGL', '메타': 'META', '테슬라': 'TSLA', '버크셔': 'BRK-B',
  'AMD': 'AMD', '인텔': 'INTC', '브로드컴': 'AVGO', '퀄컴': 'QCOM', 'TSMC': 'TSM',
  'ASML': 'ASML', '마이크론': 'MU', '팔란티어': 'PLTR', '넷플릭스': 'NFLX', '우버': 'UBER',
  '에어비앤비': 'ABNB', '디즈니': 'DIS', '나이키': 'NKE', '맥도날드': 'MCD', '스타벅스': 'SBUX',
  '코카콜라': 'KO', '펩시': 'PEP', '월마트': 'WMT', '코스트코': 'COST', '홈디포': 'HD',
  'JP모건': 'JPM', '골드만삭스': 'GS', '비자': 'V', '마스터카드': 'MA', '페이팔': 'PYPL',
  '화이자': 'PFE', '모더나': 'MRNA', '존슨앤존슨': 'JNJ', '유나이티드헬스': 'UNH',
  '엑손모빌': 'XOM', '셰브론': 'CVX', '보잉': 'BA', '캐터필러': 'CAT', 'UPS': 'UPS',
  '알리바바': 'BABA', '니오': 'NIO', '바이두': 'BIDU', '코인베이스': 'COIN', '로빈후드': 'HOOD',
};

function resolveTicker(name) {
  if (koreanToTicker[name]) return koreanToTicker[name];
  const upper = name.toUpperCase();
  return koreanToTicker[upper] || upper;
}

let exchangeRateCache = { rate: 1450, lastUpdated: 0 };

async function getExchangeRate() {
  const now = Date.now();
  if (now - exchangeRateCache.lastUpdated < 300000 && exchangeRateCache.rate) return exchangeRateCache.rate;
  try {
    const q = await yahooFinance.quote('USDKRW=X');
    if (q?.regularMarketPrice) { exchangeRateCache = { rate: q.regularMarketPrice, lastUpdated: now }; return q.regularMarketPrice; }
  } catch (e) {}
  return exchangeRateCache.rate;
}

async function calculateRSI(ticker, period = 14) {
  try {
    const end = new Date(), start = new Date(); start.setDate(start.getDate() - period * 3);
    const hist = await yahooFinance.chart(ticker, { period1: start, period2: end, interval: '1d' });
    if (!hist?.quotes || hist.quotes.length < period + 1) return null;
    const closes = hist.quotes.filter(q => q.close).map(q => q.close);
    if (closes.length < period + 1) return null;
    const changes = []; for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i-1]);
    const recent = changes.slice(-period);
    let gains = 0, losses = 0;
    for (const c of recent) { if (c > 0) gains += c; else losses += Math.abs(c); }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  } catch (e) { return null; }
}

function getRSIComment(rsi) {
  if (rsi === null) return '';
  if (rsi <= 30) return '⚠️ 과매도'; if (rsi >= 70) return '⚠️ 과매수';
  if (rsi <= 40) return '📉 매도우세'; if (rsi >= 60) return '📈 매수우세';
  return '➖ 중립';
}

function formatNumber(n) { return n == null ? '-' : n.toLocaleString('en-US'); }
function formatKRW(usd, rate) { return Math.round(usd * rate).toLocaleString('ko-KR'); }

function parseIntent(text) {
  if (/^(관심\s*종목|리스트|목록|내\s*종목)$/.test(text)) return { type: 'showWatchlist' };
  if (/^(알림\s*목록|알림\s*리스트|내\s*알림)$/.test(text)) return { type: 'showAlerts' };
  
  const addMatch = text.match(/^(.+?)\s*(추가|담아|넣어)$/);
  if (addMatch) return { type: 'addWatchlist', stockName: addMatch[1].trim() };
  
  const delMatch = text.match(/^(.+?)\s*(삭제|빼|제거|지워)$/);
  if (delMatch) return { type: 'delWatchlist', stockName: delMatch[1].trim() };
  
  const delAlertMatch = text.match(/(\d+)\s*번?\s*(삭제|취소|제거)/);
  if (delAlertMatch) return { type: 'delAlert', index: parseInt(delAlertMatch[1]) - 1 };
  
  if (/^(환율|달러|원달러|USD)$/i.test(text)) return { type: 'showExchangeRate' };
  
  const exAlertMatch = text.match(/^(\d+)\s*원?\s*(되면|알려|알림)/);
  if (exAlertMatch) return { type: 'setExchangeAlert', targetRate: parseFloat(exAlertMatch[1]) };
  
  const alertMatch = text.match(/^(.+?)\s+(\d+\.?\d*)\s*(되면|알려|알림|이상|이하)?/);
  if (alertMatch && parseFloat(alertMatch[2]) > 0) {
    return { type: 'setAlert', stockName: alertMatch[1].trim(), targetPrice: parseFloat(alertMatch[2]) };
  }
  
  if (koreanToTicker[text] || /^[A-Za-z]{1,5}$/.test(text)) return { type: 'getQuote', stockName: text };
  
  return { type: 'aiChat' };
}

// 알림 체크
async function checkAlerts() {
  if (!redis) return;
  const keys = await redis.keys('alerts:*');
  for (const key of keys) {
    const chatId = key.split(':')[1];
    const alerts = await getAlerts(chatId);
    let changed = false;
    for (let i = alerts.length - 1; i >= 0; i--) {
      try {
        const q = await yahooFinance.quote(alerts[i].ticker);
        const price = q?.regularMarketPrice;
        if (!price) continue;
        const triggered = (alerts[i].direction === 'above' && price >= alerts[i].targetPrice) ||
                         (alerts[i].direction === 'below' && price <= alerts[i].targetPrice);
        if (triggered) {
          const rate = await getExchangeRate();
          bot.sendMessage(chatId, `🔔 목표가 도달!\n\n${q.shortName || alerts[i].ticker}\n현재: $${price.toFixed(2)} (₩${formatKRW(price, rate)})\n목표: $${alerts[i].targetPrice}`);
          alerts.splice(i, 1);
          changed = true;
        }
      } catch (e) {}
    }
    if (changed) await saveAlerts(chatId, alerts);
  }
}

async function checkExchangeAlerts() {
  if (!redis) return;
  const rate = await getExchangeRate();
  const keys = await redis.keys('exchangeAlerts:*');
  for (const key of keys) {
    const chatId = key.split(':')[1];
    const alerts = await getExchangeAlerts(chatId);
    let changed = false;
    for (let i = alerts.length - 1; i >= 0; i--) {
      const triggered = (alerts[i].direction === 'above' && rate >= alerts[i].targetRate) ||
                       (alerts[i].direction === 'below' && rate <= alerts[i].targetRate);
      if (triggered) {
        bot.sendMessage(chatId, `🔔 목표 환율 도달!\n현재: ₩${formatNumber(Math.round(rate))}\n목표: ₩${formatNumber(alerts[i].targetRate)}`);
        alerts.splice(i, 1);
        changed = true;
      }
    }
    if (changed) await saveExchangeAlerts(chatId, alerts);
  }
}

async function checkScheduleAlerts() {
  if (!redis) return;
  const now = Date.now();
  const keys = await redis.keys('schedules:*');
  for (const key of keys) {
    const chatId = key.split(':')[1];
    const scheds = await getSchedules(chatId);
    let changed = false;
    for (let i = scheds.length - 1; i >= 0; i--) {
      const s = scheds[i];
      const tenMin = s.nextAlarm - 600000, nineMin = s.nextAlarm - 540000;
      if (now >= tenMin && now < nineMin && !s.notified) {
        const days = ['일','월','화','수','목','금','토'];
        const time = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
        bot.sendMessage(chatId, `⏰ 일정 알림!\n\n📌 "${s.title}"\n🕐 ${days[s.dayOfWeek]}요일 ${time}\n\n⏳ 10분 후!`);
        s.notified = true; changed = true;
      }
      if (now >= s.nextAlarm) {
        if (s.repeat) {
          const next = new Date(s.nextAlarm); next.setDate(next.getDate() + 7);
          s.nextAlarm = next.getTime(); s.notified = false; changed = true;
        } else { scheds.splice(i, 1); changed = true; }
      }
    }
    if (changed) await saveSchedules(chatId, scheds);
  }
}

setInterval(() => { checkAlerts(); checkExchangeAlerts(); checkScheduleAlerts(); }, 60000);

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `🤖 대장미주봇입니다!

💬 일상 대화 - 아무 말이나 해보세요!

📌 주식: 종목명 입력 (애플, TSLA)
📌 관심종목: "테슬라 추가" / "관심종목"
📌 알림: "테슬라 400 알려줘"
📌 환율: "환율" / "1400원 알려줘"
📅 일정: "일정 금요일 19시 회의"
📰 뉴스: "뉴스" / "디자인"`);
});

bot.onText(/\/clear/, (msg) => {
  conversationHistory[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, '🗑️ 대화 기록 초기화!');
});

async function showWatchlist(chatId) {
  const list = await getWatchlist(chatId);
  if (!list.length) { bot.sendMessage(chatId, '📋 관심종목 없음\n"테슬라 추가"로 추가하세요'); return; }
  bot.sendMessage(chatId, '⏳ 조회 중...');
  const rate = await getExchangeRate();
  let result = '📋 관심종목\n━━━━━━━━━━━━\n';
  for (const t of list) {
    try {
      const q = await yahooFinance.quote(t);
      const chg = q.regularMarketChangePercent?.toFixed(2) || '0.00';
      const arrow = parseFloat(chg) >= 0 ? '🔺' : '🔻';
      result += `${arrow} ${t}: $${q.regularMarketPrice?.toFixed(2)} (${parseFloat(chg) >= 0 ? '+' : ''}${chg}%)\n`;
    } catch (e) { result += `❌ ${t}\n`; }
  }
  result += `━━━━━━━━━━━━\n💱 $1 = ₩${formatNumber(Math.round(rate))}`;
  bot.sendMessage(chatId, result);
}

async function addToWatchlist(chatId, name) {
  const ticker = resolveTicker(name);
  try {
    const q = await yahooFinance.quote(ticker);
    if (!q?.regularMarketPrice) { bot.sendMessage(chatId, `❌ "${name}" 없음`); return; }
    const list = await getWatchlist(chatId);
    if (list.includes(ticker)) { bot.sendMessage(chatId, `⚠️ ${ticker} 이미 있음`); return; }
    list.push(ticker);
    await saveWatchlist(chatId, list);
    bot.sendMessage(chatId, `✅ ${q.shortName || ticker} 추가됨`);
  } catch (e) { bot.sendMessage(chatId, `❌ 추가 실패`); }
}

async function delFromWatchlist(chatId, name) {
  const ticker = resolveTicker(name);
  const list = await getWatchlist(chatId);
  if (!list.includes(ticker)) { bot.sendMessage(chatId, `⚠️ ${ticker} 없음`); return; }
  await saveWatchlist(chatId, list.filter(t => t !== ticker));
  bot.sendMessage(chatId, `🗑️ ${ticker} 삭제됨`);
}

async function showAlerts(chatId) {
  const alerts = await getAlerts(chatId);
  if (!alerts.length) { bot.sendMessage(chatId, '🔔 알림 없음'); return; }
  let result = '🔔 알림 목록\n━━━━━━━━━━━━\n';
  alerts.forEach((a, i) => { result += `${i+1}. ${a.ticker} $${a.targetPrice} ${a.direction === 'above' ? '이상' : '이하'}\n`; });
  result += '━━━━━━━━━━━━\n삭제: "1번 삭제"';
  bot.sendMessage(chatId, result);
}

async function setAlert(chatId, name, targetPrice) {
  const ticker = resolveTicker(name);
  try {
    const q = await yahooFinance.quote(ticker);
    if (!q?.regularMarketPrice) { bot.sendMessage(chatId, `❌ "${name}" 없음`); return; }
    const direction = targetPrice >= q.regularMarketPrice ? 'above' : 'below';
    const alerts = await getAlerts(chatId);
    alerts.push({ ticker, targetPrice, direction });
    await saveAlerts(chatId, alerts);
    const rate = await getExchangeRate();
    bot.sendMessage(chatId, `🔔 알림 설정!\n\n${q.shortName || ticker}\n현재: $${q.regularMarketPrice.toFixed(2)}\n목표: $${targetPrice} ${direction === 'above' ? '이상' : '이하'}`);
  } catch (e) { bot.sendMessage(chatId, `❌ 설정 실패`); }
}

async function delAlert(chatId, index) {
  const alerts = await getAlerts(chatId);
  if (!alerts[index]) { bot.sendMessage(chatId, '❌ 알림 없음'); return; }
  const removed = alerts.splice(index, 1)[0];
  await saveAlerts(chatId, alerts);
  bot.sendMessage(chatId, `🗑️ ${removed.ticker} $${removed.targetPrice} 삭제됨`);
}

async function showExchangeRate(chatId) {
  try {
    const q = await yahooFinance.quote('USDKRW=X');
    const rate = q?.regularMarketPrice;
    const chg = q?.regularMarketChangePercent || 0;
    const arrow = chg >= 0 ? '🔺' : '🔻';
    bot.sendMessage(chatId, `💱 환율\n━━━━━━━━━━━━\n₩${formatNumber(Math.round(rate))}\n${arrow} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%\n━━━━━━━━━━━━\n"1400원 알려줘" - 알림설정`);
  } catch (e) { bot.sendMessage(chatId, '❌ 환율 조회 실패'); }
}

async function setExchangeAlert(chatId, targetRate) {
  const rate = await getExchangeRate();
  const direction = targetRate >= rate ? 'above' : 'below';
  const alerts = await getExchangeAlerts(chatId);
  alerts.push({ targetRate, direction });
  await saveExchangeAlerts(chatId, alerts);
  bot.sendMessage(chatId, `🔔 환율 알림 설정!\n현재: ₩${formatNumber(Math.round(rate))}\n목표: ₩${formatNumber(targetRate)} ${direction === 'above' ? '이상' : '이하'}`);
}

async function getQuote(chatId, name) {
  const ticker = resolveTicker(name);
  try {
    const [q, rsi, rate] = await Promise.all([yahooFinance.quote(ticker), calculateRSI(ticker), getExchangeRate()]);
    if (!q?.regularMarketPrice) { bot.sendMessage(chatId, `❌ "${name}" 없음`); return; }
    const price = q.regularMarketPrice;
    const chg = q.regularMarketChange || 0;
    const chgPct = q.regularMarketChangePercent || 0;
    const arrow = chg >= 0 ? '🔺' : '🔻';
    const sign = chg >= 0 ? '+' : '';
    
    let msg = `📊 ${q.shortName || ticker} (${ticker})
━━━━━━━━━━━━

💵 $${price.toFixed(2)} (₩${formatKRW(price, rate)})
${arrow} ${sign}${chg.toFixed(2)} (${sign}${chgPct.toFixed(2)}%)

📈 RSI: ${rsi ? rsi.toFixed(1) : '-'} ${getRSIComment(rsi)}
📉 52주: $${q.fiftyTwoWeekLow?.toFixed(2) || '-'} ~ $${q.fiftyTwoWeekHigh?.toFixed(2) || '-'}
📊 거래량: ${formatNumber(q.regularMarketVolume)}`;

    if (q.dividendYield) msg += `\n💰 배당: ${q.dividendYield.toFixed(2)}%`;
    msg += `\n\n💱 $1 = ₩${formatNumber(Math.round(rate))}`;
    bot.sendMessage(chatId, msg);
  } catch (e) { bot.sendMessage(chatId, `❌ 조회 실패`); }
}

// 일정 관련
function parseDay(t) { return { '일':0,'월':1,'화':2,'수':3,'목':4,'금':5,'토':6 }[t]; }

function parseSchedule(text) {
  let m = text.match(/매주\s*(월|화|수|목|금|토|일)요?일?\s*(\d{1,2})[:시]?\s*(\d{0,2})분?\s*(.+)/);
  if (m) return { type: 'repeat', dayOfWeek: parseDay(m[1]), hour: parseInt(m[2]), minute: parseInt(m[3]) || 0, title: m[4].trim() };
  
  m = text.match(/(월|화|수|목|금|토|일)요?일?\s*(\d{1,2})[:시]?\s*(\d{0,2})분?\s*(.+)/);
  if (m) return { type: 'once', dayOfWeek: parseDay(m[1]), hour: parseInt(m[2]), minute: parseInt(m[3]) || 0, title: m[4].trim() };
  
  m = text.match(/(오늘|내일)\s*(\d{1,2})[:시]?\s*(\d{0,2})분?\s*(.+)/);
  if (m) {
    const d = new Date(); if (m[1] === '내일') d.setDate(d.getDate() + 1);
    return { type: 'once', dayOfWeek: d.getDay(), hour: parseInt(m[2]), minute: parseInt(m[3]) || 0, title: m[4].trim(), specificDate: d };
  }
  return null;
}

async function addSchedule(chatId, data) {
  const scheds = await getSchedules(chatId);
  const now = new Date();
  let nextAlarm;
  
  if (data.specificDate) {
    nextAlarm = new Date(data.specificDate);
  } else {
    nextAlarm = new Date();
    let daysUntil = data.dayOfWeek - now.getDay();
    if (daysUntil <= 0) daysUntil += 7;
    nextAlarm.setDate(now.getDate() + daysUntil);
  }
  nextAlarm.setHours(data.hour, data.minute, 0, 0);
  if (nextAlarm <= now) nextAlarm.setDate(nextAlarm.getDate() + 7);

  const sched = { id: Date.now(), title: data.title, dayOfWeek: data.dayOfWeek, hour: data.hour, minute: data.minute, repeat: data.type === 'repeat', nextAlarm: nextAlarm.getTime(), notified: false };
  scheds.push(sched);
  await saveSchedules(chatId, scheds);
  return sched;
}

async function showSchedules(chatId) {
  const scheds = await getSchedules(chatId);
  if (!scheds.length) return '📅 일정 없음\n\n"일정 금요일 19시 회의" 형식으로 추가';
  const days = ['일','월','화','수','목','금','토'];
  let result = '📅 일정 목록\n━━━━━━━━━━━━\n';
  scheds.forEach((s, i) => {
    const time = `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`;
    const next = new Date(s.nextAlarm);
    result += `${i+1}. ${s.repeat ? '🔁' : '📌'} ${s.repeat ? '매주 ' : ''}${days[s.dayOfWeek]}요일 ${time}\n   "${s.title}"\n   다음: ${next.getMonth()+1}/${next.getDate()}\n\n`;
  });
  result += '━━━━━━━━━━━━\n삭제: "일정 1번 삭제"';
  return result;
}

async function deleteSchedule(chatId, index) {
  const scheds = await getSchedules(chatId);
  if (!scheds[index]) return '❌ 일정 없음';
  const removed = scheds.splice(index, 1)[0];
  await saveSchedules(chatId, scheds);
  return `🗑️ "${removed.title}" 삭제됨`;
}

// 뉴스
async function getMarketData() {
  try {
    const symbols = ['BTC-USD', '^GSPC', '^IXIC', 'USDKRW=X'];
    const quotes = await Promise.all(symbols.map(s => yahooFinance.quote(s).catch(() => null)));
    return { bitcoin: quotes[0], sp500: quotes[1], nasdaq: quotes[2], usdkrw: quotes[3] };
  } catch (e) { return null; }
}

async function generateNewsBriefing() {
  let msg = `📰 브리핑\n━━━━━━━━━━━━\n${new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}\n\n`;
  const data = await getMarketData();
  if (data) {
    if (data.usdkrw) {
      const chg = data.usdkrw.regularMarketChangePercent || 0;
      msg += `💵 환율: ₩${formatNumber(Math.round(data.usdkrw.regularMarketPrice))} ${chg >= 0 ? '🔺' : '🔻'}${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%\n`;
    }
    if (data.sp500) {
      const chg = data.sp500.regularMarketChangePercent || 0;
      msg += `📈 S&P500: ${formatNumber(Math.round(data.sp500.regularMarketPrice))} ${chg >= 0 ? '🔺' : '🔻'}${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%\n`;
    }
    if (data.nasdaq) {
      const chg = data.nasdaq.regularMarketChangePercent || 0;
      msg += `📈 나스닥: ${formatNumber(Math.round(data.nasdaq.regularMarketPrice))} ${chg >= 0 ? '🔺' : '🔻'}${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%\n`;
    }
    if (data.bitcoin) {
      const chg = data.bitcoin.regularMarketChangePercent || 0;
      msg += `₿ 비트코인: $${formatNumber(Math.round(data.bitcoin.regularMarketPrice))} ${chg >= 0 ? '🔺' : '🔻'}${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%\n`;
    }
  }
  msg += `\n━━━━━━━━━━━━\n🤖 대장미주봇`;
  return msg;
}

async function sendNewsBriefing(chatId) {
  bot.sendMessage(chatId, '⏳ 브리핑 생성 중...');
  const briefing = await generateNewsBriefing();
  bot.sendMessage(chatId, briefing);
}

async function sendDesignBriefing(chatId) {
  let msg = `✨ 디자인 브리핑\n━━━━━━━━━━━━\n${new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}\n\n`;
  msg += `🔗 참고 사이트\n• Dribbble\n• Behance\n• Awwwards\n• Mobbin\n\n`;
  msg += `💡 트렌드\n#Bento #Glassmorphism #3D\n\n━━━━━━━━━━━━\n🤖 대장미주봇`;
  bot.sendMessage(chatId, msg);
}

// 스케줄러
cron.schedule('0 22 * * *', async () => {
  const subs = await loadBriefingSubscribers();
  const briefing = await generateNewsBriefing();
  for (const chatId of subs) { try { bot.sendMessage(chatId, briefing); } catch (e) {} }
});

// 메시지 핸들러
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const input = msg.text?.trim();
  if (!input || input.startsWith('/')) return;

  // 구독자 등록
  if (redis) {
    const subs = await loadBriefingSubscribers();
    subs.add(chatId);
    await saveBriefingSubscribers(subs);
  }

  // 뉴스/디자인
  if (/^(뉴스|브리핑|news)$/i.test(input)) { await sendNewsBriefing(chatId); return; }
  if (/^(디자인|design)$/i.test(input)) { await sendDesignBriefing(chatId); return; }

  // 일정
  if (/^(일정|일정\s*목록)$/.test(input)) { bot.sendMessage(chatId, await showSchedules(chatId)); return; }
  
  const schedDelMatch = input.match(/일정\s*(\d+)\s*번?\s*(삭제|취소)/);
  if (schedDelMatch) { bot.sendMessage(chatId, await deleteSchedule(chatId, parseInt(schedDelMatch[1]) - 1)); return; }
  
  const schedAddMatch = input.match(/^일정\s+(.+)/);
  if (schedAddMatch) {
    const parsed = parseSchedule(schedAddMatch[1].trim());
    if (parsed) {
      const sched = await addSchedule(chatId, parsed);
      const days = ['일','월','화','수','목','금','토'];
      const time = `${String(sched.hour).padStart(2,'0')}:${String(sched.minute).padStart(2,'0')}`;
      const next = new Date(sched.nextAlarm);
      bot.sendMessage(chatId, `✅ 일정 등록!\n\n📌 "${sched.title}"\n🗓️ ${sched.repeat ? '매주 ' : ''}${days[sched.dayOfWeek]}요일 ${time}\n⏰ 다음: ${next.getMonth()+1}월 ${next.getDate()}일 (10분 전 알림)${sched.repeat ? '\n🔁 매주 반복' : ''}`);
      return;
    }
  }

  // 기타
  const intent = parseIntent(input);
  switch (intent.type) {
    case 'showWatchlist': await showWatchlist(chatId); break;
    case 'showAlerts': await showAlerts(chatId); break;
    case 'addWatchlist': await addToWatchlist(chatId, intent.stockName); break;
    case 'delWatchlist': await delFromWatchlist(chatId, intent.stockName); break;
    case 'setAlert': await setAlert(chatId, intent.stockName, intent.targetPrice); break;
    case 'delAlert': await delAlert(chatId, intent.index); break;
    case 'showExchangeRate': await showExchangeRate(chatId); break;
    case 'setExchangeAlert': await setExchangeAlert(chatId, intent.targetRate); break;
    case 'getQuote': await getQuote(chatId, intent.stockName); break;
    case 'aiChat':
      const res = await getAIResponse(chatId, input);
      bot.sendMessage(chatId, res || '🤖 AI 응답 실패. 잠시 후 다시 시도해주세요.');
      break;
  }
});

console.log('Bot started with Redis!');
