const TelegramBot = require('node-telegram-bot-api');
const yahooFinance = require('yahoo-finance2').default;
const axios = require('axios');
const cheerio = require('cheerio');
const schedule = require('node-schedule');

// 환경변수에서 토큰 가져오기 (Railway 배포용)
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8576664680:AAEYh0jk2rOMQE4XZVg4ISUBqMLmyeLHgZ0';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ========== 기존 주식봇 코드 (그대로 유지) ==========

// 한글 종목명 → 티커 매핑 (미국 시가총액 상위 300개)
const koreanToTicker = {
  // === 빅테크 / 메가캡 ===
  '애플': 'AAPL', '마이크로소프트': 'MSFT', 'MS': 'MSFT',
  '엔비디아': 'NVDA', '아마존': 'AMZN', '알파벳': 'GOOGL', '구글': 'GOOGL',
  '메타': 'META', '페이스북': 'META', '테슬라': 'TSLA',
  '버크셔해서웨이': 'BRK-B', '버크셔': 'BRK-B',

  // === 반도체 ===
  'AMD': 'AMD', '에이엠디': 'AMD', '인텔': 'INTC', '브로드컴': 'AVGO',
  '퀄컴': 'QCOM', 'TSMC': 'TSM', '대만반도체': 'TSM', 'ASML': 'ASML',
  '텍사스인스트루먼트': 'TXN', '마이크론': 'MU', '램리서치': 'LRCX',
  '어플라이드머티리얼즈': 'AMAT', 'KLA': 'KLAC', '마벨테크놀로지': 'MRVL',
  'ARM': 'ARM', '아나로그디바이스': 'ADI', '시놉시스': 'SNPS',
  '케이던스': 'CDNS', '온세미컨덕터': 'ON', 'NXP': 'NXPI',
  '스카이웍스': 'SWKS', '모놀리식파워': 'MPWR', '슈퍼마이크로': 'SMCI',

  // === 소프트웨어 / 클라우드 ===
  '오라클': 'ORCL', '세일즈포스': 'CRM', '어도비': 'ADBE', 'SAP': 'SAP',
  '인튜이트': 'INTU', '서비스나우': 'NOW', '팔란티어': 'PLTR',
  '스노우플레이크': 'SNOW', '데이터독': 'DDOG', '크라우드스트라이크': 'CRWD',
  '줌': 'ZM', '도큐사인': 'DOCU', '아틀라시안': 'TEAM', '몽고DB': 'MDB',
  '클라우드플레어': 'NET', '오클타': 'OKTA', '지스케일러': 'ZS',
  '트위리오': 'TWLO', '유아이패스': 'PATH', '허브스팟': 'HUBS',
  '센티넬원': 'S', '포티넷': 'FTNT', '팔로알토네트웍스': 'PANW',
  '스플렁크': 'SPLK', '앤시스': 'ANSS', '오토데스크': 'ADSK',
  'PTC': 'PTC', '워크데이': 'WDAY', '코히어런트': 'COHR',

  // (이하 매핑 생략 - 기존 코드 그대로)
};

// 티커 변환 함수 (소문자 입력도 지원)
function resolveTicker(stockName) {
  if (koreanToTicker[stockName]) {
    return koreanToTicker[stockName];
  }
  const upper = stockName.toUpperCase();
  if (koreanToTicker[upper]) {
    return koreanToTicker[upper];
  }
  return upper;
}

// 관심종목 저장 (chatId별)
const watchlist = {};

// 목표가 알림 저장 (chatId별)
const alerts = {};

// 환율 알림 저장 (chatId별)
const exchangeAlerts = {};

// 환율 캐시 (5분마다 갱신)
let exchangeRateCache = { rate: 1450, lastUpdated: 0 };

// 환율 가져오기 (USD/KRW)
async function getExchangeRate() {
  const now = Date.now();
  if (now - exchangeRateCache.lastUpdated < 5 * 60 * 1000 && exchangeRateCache.rate) {
    return exchangeRateCache.rate;
  }

  try {
    const quote = await yahooFinance.quote('USDKRW=X');
    if (quote && quote.regularMarketPrice) {
      exchangeRateCache = { rate: quote.regularMarketPrice, lastUpdated: now };
      return quote.regularMarketPrice;
    }
  } catch (error) {
    // 실패 시 캐시된 값 또는 기본값 사용
  }
  return exchangeRateCache.rate || 1450;
}

// RSI 계산 함수 (14일 기준)
async function calculateRSI(ticker, period = 14) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (period * 3));

    const history = await yahooFinance.chart(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    if (!history || !history.quotes || history.quotes.length < period + 1) {
      return null;
    }

    const closes = history.quotes
      .filter(q => q.close !== null)
      .map(q => q.close);

    if (closes.length < period + 1) return null;

    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    const recentChanges = changes.slice(-period);

    let gains = 0;
    let losses = 0;

    for (const change of recentChanges) {
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  } catch (error) {
    return null;
  }
}

// RSI 코멘트
function getRSIComment(rsi) {
  if (rsi === null) return '';
  if (rsi <= 30) return '⚠️ 과매도 구간';
  if (rsi >= 70) return '⚠️ 과매수 구간';
  if (rsi <= 40) return '📉 매도 우세';
  if (rsi >= 60) return '📈 매수 우세';
  return '➖ 중립';
}

// 숫자 포맷 (천 단위 콤마)
function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString('en-US');
}

// 원화 포맷
function formatKRW(usd, rate) {
  const krw = usd * rate;
  return Math.round(krw).toLocaleString('ko-KR');
}

// ========== 뉴스 브리핑 기능 추가 ==========

// 네이버 뉴스 크롤링
async function getNaverNews(query, count = 3) {
  try {
    const url = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(query)}&sort=1`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const news = [];
    
    $('.news_area').slice(0, count).each((i, elem) => {
      const title = $(elem).find('.news_tit').text().trim();
      const link = $(elem).find('.news_tit').attr('href');
      
      if (title) {
        news.push({ title, link });
      }
    });
    
    return news;
  } catch (error) {
    console.error(`뉴스 크롤링 오류 (${query}):`, error.message);
    return [];
  }
}

// 실시간 시세 데이터 (주식/비트코인/금)
async function getMarketData() {
  const data = {};

  try {
    // 환율 (USD/KRW)
    const rate = await getExchangeRate();
    data.usdkrw = Math.round(rate);

    // 비트코인 (업비트)
    const btcResponse = await axios.get('https://api.upbit.com/v1/ticker?markets=KRW-BTC');
    if (btcResponse.data && btcResponse.data[0]) {
      const btcPrice = btcResponse.data[0].trade_price;
      const btcChange = btcResponse.data[0].signed_change_rate * 100;
      data.bitcoin = {
        price: Math.round(btcPrice),
        change: btcChange.toFixed(2)
      };
    }

    // 금 시세 (GLD ETF)
    const goldQuote = await yahooFinance.quote('GLD');
    if (goldQuote && goldQuote.regularMarketPrice) {
      const goldPrice = goldQuote.regularMarketPrice;
      const goldChange = goldQuote.regularMarketChangePercent || 0;
      data.gold = {
        price: goldPrice.toFixed(2),
        change: goldChange.toFixed(2)
      };
    }

    // 코스피
    const kospiQuote = await yahooFinance.quote('^KS11');
    if (kospiQuote && kospiQuote.regularMarketPrice) {
      data.kospi = {
        price: kospiQuote.regularMarketPrice.toFixed(2),
        change: (kospiQuote.regularMarketChangePercent || 0).toFixed(2)
      };
    }

    // 나스닥
    const nasdaqQuote = await yahooFinance.quote('^IXIC');
    if (nasdaqQuote && nasdaqQuote.regularMarketPrice) {
      data.nasdaq = {
        price: nasdaqQuote.regularMarketPrice.toFixed(2),
        change: (nasdaqQuote.regularMarketChangePercent || 0).toFixed(2)
      };
    }

    // 다우
    const dowQuote = await yahooFinance.quote('^DJI');
    if (dowQuote && dowQuote.regularMarketPrice) {
      data.dow = {
        price: dowQuote.regularMarketPrice.toFixed(2),
        change: (dowQuote.regularMarketChangePercent || 0).toFixed(2)
      };
    }

  } catch (error) {
    console.error('시세 데이터 오류:', error.message);
  }

  return data;
}

// 매일 오전 7시 뉴스 브리핑 생성
async function generateDailyBriefing() {
  console.log('매일 브리핑 생성 시작...');
  
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][today.getDay()];

  // 뉴스 수집
  const [mainNews, realEstateNews, usMarketNews, krMarketNews, aiNews, photoNews, marketData] = await Promise.all([
    getNaverNews('주요뉴스', 3),
    getNaverNews('부동산', 3),
    getNaverNews('미국증시', 3),
    getNaverNews('국내증시', 3),
    getNaverNews('인공지능', 3),
    getNaverNews('포토그래퍼', 2),
    getMarketData()
  ]);

  // 브리핑 메시지 구성
  let message = `📰 ${dateStr} (${dayOfWeek}) 뉴스 브리핑\n\n`;
  
  message += `━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 실시간 시세\n`;
  message += `━━━━━━━━━━━━━━━━━━\n`;
  
  if (marketData.usdkrw) {
    message += `💵 USD/KRW: ₩${formatNumber(marketData.usdkrw)}\n`;
  }
  
  if (marketData.bitcoin) {
    const btcArrow = parseFloat(marketData.bitcoin.change) >= 0 ? '🔺' : '🔻';
    message += `₿ 비트코인: ₩${formatNumber(marketData.bitcoin.price)} ${btcArrow}${marketData.bitcoin.change}%\n`;
  }
  
  if (marketData.gold) {
    const goldArrow = parseFloat(marketData.gold.change) >= 0 ? '🔺' : '🔻';
    message += `🥇 금(GLD): $${marketData.gold.price} ${goldArrow}${marketData.gold.change}%\n`;
  }
  
  if (marketData.kospi) {
    const kospiArrow = parseFloat(marketData.kospi.change) >= 0 ? '🔺' : '🔻';
    message += `📈 코스피: ${marketData.kospi.price} ${kospiArrow}${marketData.kospi.change}%\n`;
  }
  
  if (marketData.nasdaq) {
    const nasdaqArrow = parseFloat(marketData.nasdaq.change) >= 0 ? '🔺' : '🔻';
    message += `🇺🇸 나스닥: ${marketData.nasdaq.price} ${nasdaqArrow}${marketData.nasdaq.change}%\n`;
  }
  
  if (marketData.dow) {
    const dowArrow = parseFloat(marketData.dow.change) >= 0 ? '🔺' : '🔻';
    message += `🇺🇸 다우: ${marketData.dow.price} ${dowArrow}${marketData.dow.change}%\n`;
  }
  
  message += `\n`;

  // 주요 뉴스
  message += `━━━━━━━━━━━━━━━━━━\n`;
  message += `🔴 주요 뉴스\n`;
  message += `━━━━━━━━━━━━━━━━━━\n`;
  mainNews.forEach((news, i) => {
    message += `${i + 1}. ${news.title}\n`;
  });
  message += `\n`;

  // 부동산 뉴스
  message += `🏠 부동산 뉴스\n`;
  realEstateNews.forEach((news) => {
    message += `• ${news.title}\n`;
  });
  message += `\n`;

  // 미국 증시
  message += `🇺🇸 미국 증시\n`;
  usMarketNews.forEach((news) => {
    message += `• ${news.title}\n`;
  });
  message += `\n`;

  // 국내 증시
  message += `🇰🇷 국내 증시\n`;
  krMarketNews.forEach((news) => {
    message += `• ${news.title}\n`;
  });
  message += `\n`;

  // AI/테크 소식
  message += `🤖 AI/테크 소식\n`;
  aiNews.forEach((news) => {
    message += `• ${news.title}\n`;
  });
  message += `\n`;

  // 포토그래퍼 소식
  if (photoNews.length > 0) {
    message += `📸 포토그래퍼 소식\n`;
    photoNews.forEach((news) => {
      message += `• ${news.title}\n`;
    });
  }

  return message;
}

// 격일 디자인 브리핑 생성
async function generateDesignBriefing() {
  console.log('디자인 브리핑 생성 시작...');
  
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  const designNews = await getNaverNews('디자인 트렌드', 5);
  
  let message = `🎨 ${dateStr} 디자인 브리핑\n\n`;
  
  message += `━━━━━━━━━━━━━━━━━━\n`;
  message += `✨ 핫한 디자인 소식\n`;
  message += `━━━━━━━━━━━━━━━━━━\n`;
  designNews.forEach((news, i) => {
    message += `${i + 1}. ${news.title}\n`;
  });
  message += `\n`;

  message += `🔗 디자인 참고 사이트\n`;
  message += `• Behance: behance.net\n`;
  message += `• Dribbble: dribbble.com\n`;
  message += `• Awwwards: awwwards.com\n`;
  message += `• Pinterest Design\n`;
  message += `• Designspiration\n`;

  return message;
}

// 모든 사용자에게 브리핑 전송
async function sendBriefingToAll(message) {
  // 관심종목이 있는 모든 사용자에게 전송
  const chatIds = Object.keys(watchlist);
  
  if (chatIds.length === 0) {
    console.log('브리핑 받을 사용자 없음');
    return;
  }

  for (const chatId of chatIds) {
    try {
      await bot.sendMessage(chatId, message);
      console.log(`브리핑 전송 완료: ${chatId}`);
    } catch (error) {
      console.error(`브리핑 전송 실패 (${chatId}):`, error.message);
    }
  }
}

// 스케줄 설정
function setupNewsSchedule() {
  // 매일 오전 7시 - 뉴스 브리핑
  schedule.scheduleJob('0 7 * * *', async () => {
    console.log('매일 브리핑 실행');
    const briefing = await generateDailyBriefing();
    await sendBriefingToAll(briefing);
  });

  // 격일 오전 7시 10분 - 디자인 브리핑 (홀수 날짜)
  schedule.scheduleJob('10 7 */2 * *', async () => {
    console.log('디자인 브리핑 실행');
    const designBriefing = await generateDesignBriefing();
    await sendBriefingToAll(designBriefing);
  });

  console.log('뉴스 브리핑 스케줄 설정 완료');
  console.log('- 매일 오전 7시: 뉴스 브리핑');
  console.log('- 격일 오전 7시 10분: 디자인 브리핑');
}

// ========== 기존 주식봇 기능들 (그대로 유지) ==========

// 자연어 파싱 함수들
function parseIntent(text) {
  // 뉴스 브리핑 테스트
  if (/^(뉴스|브리핑|오늘뉴스)$/.test(text)) {
    return { type: 'testBriefing' };
  }

  // 디자인 브리핑 테스트
  if (/^(디자인|디자인뉴스)$/.test(text)) {
    return { type: 'testDesign' };
  }

  // 관심종목 보기
  if (/^(관심\s*종목|리스트|목록|내\s*종목)$/.test(text)) {
    return { type: 'showWatchlist' };
  }

  // 알림 목록 보기
  if (/^(알림\s*목록|알림\s*리스트|내\s*알림|설정\s*알림)$/.test(text)) {
    return { type: 'showAlerts' };
  }

  // 관심종목 추가
  const addMatch = text.match(/^(.+?)\s*(추가|담아|넣어|추가해줘|담아줘|넣어줘)$/);
  if (addMatch) {
    return { type: 'addWatchlist', stockName: addMatch[1].trim() };
  }

  // 관심종목 삭제
  const delMatch = text.match(/^(.+?)\s*(삭제|빼줘|제거|빼|지워|지워줘)$/);
  if (delMatch) {
    return { type: 'delWatchlist', stockName: delMatch[1].trim() };
  }

  // 알림 삭제
  const delAlertMatch = text.match(/(?:알림\s*)?(\d+)\s*번?\s*(?:알림\s*)?(?:삭제|취소|제거)/);
  if (delAlertMatch) {
    return { type: 'delAlert', index: parseInt(delAlertMatch[1]) - 1 };
  }

  // 환율 조회
  if (/^(환율|달러|원달러|달러환율|USD|usd)$/.test(text)) {
    return { type: 'showExchangeRate' };
  }

  // 환율 알림
  const exchangeAlertPatterns = [
    /^(\d+\.?\d*)\s*원?\s*(?:되면|도달하면|넘으면|내려가면|떨어지면)?\s*(?:알려줘|알림|알려|노티)/,
    /^환율\s*(\d+\.?\d*)\s*(?:되면|도달하면)?\s*(?:알려줘|알림|알려)?/,
    /^(\d+\.?\d*)\s*원\s*(?:이상|이하|도달|돌파)/,
  ];
  for (const pattern of exchangeAlertPatterns) {
    const match = text.match(pattern);
    if (match) {
      const targetRate = parseFloat(match[1]);
      if (targetRate > 0) {
        return { type: 'setExchangeAlert', targetRate };
      }
    }
  }

  // 목표가 알림
  const alertPatterns = [
    /^(.+?)\s+(\d+\.?\d*)\s*(?:되면|도달하면|넘으면|내려가면|떨어지면)?\s*(?:알려줘|알림|알려|노티|알려줘요)/,
    /^(.+?)\s+(\d+\.?\d*)\s*(?:이상|이하|도달|돌파)/,
    /^([A-Za-z][A-Za-z0-9\-\.]*)\s+(\d+\.?\d*)\s*(?:alert|알림)?$/i,
  ];
  for (const pattern of alertPatterns) {
    const match = text.match(pattern);
    if (match) {
      const stockName = match[1].trim();
      const targetPrice = parseFloat(match[2]);
      if (targetPrice > 0) {
        return { type: 'setAlert', stockName, targetPrice };
      }
    }
  }

  return { type: 'getQuote', stockName: text };
}

// 알림 체크 함수 (1분마다 실행)
async function checkAlerts() {
  for (const chatId of Object.keys(alerts)) {
    const userAlerts = alerts[chatId];
    if (!userAlerts || userAlerts.length === 0) continue;

    for (let i = userAlerts.length - 1; i >= 0; i--) {
      const alert = userAlerts[i];
      try {
        const quote = await yahooFinance.quote(alert.ticker);
        const currentPrice = quote?.regularMarketPrice;

        if (!currentPrice) continue;

        let triggered = false;
        if (alert.direction === 'above' && currentPrice >= alert.targetPrice) {
          triggered = true;
        } else if (alert.direction === 'below' && currentPrice <= alert.targetPrice) {
          triggered = true;
        }

        if (triggered) {
          const name = quote.shortName || alert.ticker;
          const rate = await getExchangeRate();
          bot.sendMessage(chatId, `🔔 목표가 도달!\n\n${name} (${alert.ticker})\n현재가: $${currentPrice.toFixed(2)} (₩${formatKRW(currentPrice, rate)})\n목표가: $${alert.targetPrice}`);
          userAlerts.splice(i, 1);
        }
      } catch (error) {
        // 조회 실패 시 무시
      }
    }
  }
}

// 환율 알림 체크 함수
async function checkExchangeAlerts() {
  const currentRate = await getExchangeRate();
  if (!currentRate) return;

  for (const chatId of Object.keys(exchangeAlerts)) {
    const userAlerts = exchangeAlerts[chatId];
    if (!userAlerts || userAlerts.length === 0) continue;

    for (let i = userAlerts.length - 1; i >= 0; i--) {
      const alert = userAlerts[i];
      let triggered = false;

      if (alert.direction === 'above' && currentRate >= alert.targetRate) {
        triggered = true;
      } else if (alert.direction === 'below' && currentRate <= alert.targetRate) {
        triggered = true;
      }

      if (triggered) {
        const dirText = alert.direction === 'above' ? '이상' : '이하';
        bot.sendMessage(chatId, `🔔 목표 환율 도달!\n\n💱 현재 환율: ₩${formatNumber(Math.round(currentRate))}\n🎯 목표 환율: ₩${formatNumber(alert.targetRate)} ${dirText}`);
        userAlerts.splice(i, 1);
      }
    }
  }
}

// 1분마다 알림 체크
setInterval(() => {
  checkAlerts();
  checkExchangeAlerts();
}, 60000);

console.log('Stock Bot with News Briefing is running...');

// 스케줄 시작
setupNewsSchedule();

// /start 명령어
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `미국 주식 + 뉴스 브리핑 봇입니다.

📊 주식 기능
종목명 입력 (예: 애플, TSLA)
→ 현재가, RSI, 52주 고저, 배당 등

"관심종목" - 목록 보기
"테슬라 추가" - 추가
"테슬라 400 알려줘" - 목표가 알림
"환율" - USD/KRW 환율

📰 뉴스 기능 (NEW!)
"뉴스" - 오늘 뉴스 브리핑 보기
"디자인" - 디자인 뉴스 보기

⏰ 자동 브리핑
매일 오전 7시 - 뉴스 브리핑
격일 오전 7시 10분 - 디자인 브리핑`);
});

// 관심종목 보기 함수
async function showWatchlist(chatId) {
  if (!watchlist[chatId] || watchlist[chatId].length === 0) {
    bot.sendMessage(chatId, '📋 관심종목이 없습니다.\n"테슬라 추가" 형식으로 추가하세요.');
    return;
  }

  bot.sendMessage(chatId, '⏳ 관심종목 조회 중...');

  const rate = await getExchangeRate();
  let result = '📋 관심종목 현재가\n━━━━━━━━━━━━━━━\n';

  for (const ticker of watchlist[chatId]) {
    try {
      const quote = await yahooFinance.quote(ticker);
      const price = quote.regularMarketPrice;
      const changePercent = quote.regularMarketChangePercent?.toFixed(2) || '0.00';
      const arrow = parseFloat(changePercent) >= 0 ? '🔺' : '🔻';
      const sign = parseFloat(changePercent) >= 0 ? '+' : '';

      result += `${arrow} ${ticker}: $${price?.toFixed(2)} (${sign}${changePercent}%)\n`;
    } catch (error) {
      result += `❌ ${ticker}: 조회 실패\n`;
    }
  }

  result += `━━━━━━━━━━━━━━━\n💱 환율: $1 = ₩${formatNumber(Math.round(rate))}`;
  bot.sendMessage(chatId, result);
}

// 알림 목록 보기 함수
function showAlerts(chatId) {
  if (!alerts[chatId] || alerts[chatId].length === 0) {
    bot.sendMessage(chatId, '🔔 설정된 알림이 없습니다.');
    return;
  }

  let result = '🔔 목표가 알림 목록\n━━━━━━━━━━━━━━━\n';
  alerts[chatId].forEach((alert, index) => {
    const dir = alert.direction === 'above' ? '이상' : '이하';
    result += `${index + 1}. ${alert.ticker} $${alert.targetPrice} ${dir}\n`;
  });
  result += '━━━━━━━━━━━━━━━\n삭제: "1번 삭제"';

  bot.sendMessage(chatId, result);
}

// 관심종목 추가 함수
async function addToWatchlist(chatId, stockName) {
  const ticker = resolveTicker(stockName);

  try {
    const quote = await yahooFinance.quote(ticker);
    if (!quote || !quote.regularMarketPrice) {
      bot.sendMessage(chatId, `❌ "${stockName}" 티커를 찾을 수 없습니다.`);
      return;
    }

    if (!watchlist[chatId]) watchlist[chatId] = [];

    if (watchlist[chatId].includes(ticker)) {
      bot.sendMessage(chatId, `⚠️ ${quote.shortName} (${ticker})은 이미 관심종목에 있습니다.`);
      return;
    }

    watchlist[chatId].push(ticker);
    bot.sendMessage(chatId, `✅ ${quote.shortName} (${ticker}) 관심종목에 추가했습니다.`);
  } catch (error) {
    bot.sendMessage(chatId, `❌ "${stockName}" 추가 실패`);
  }
}

// 관심종목 삭제 함수
function delFromWatchlist(chatId, stockName) {
  const ticker = resolveTicker(stockName);

  if (!watchlist[chatId] || !watchlist[chatId].includes(ticker)) {
    bot.sendMessage(chatId, `⚠️ ${ticker}은 관심종목에 없습니다.`);
    return;
  }

  watchlist[chatId] = watchlist[chatId].filter(t => t !== ticker);
  bot.sendMessage(chatId, `🗑️ ${ticker} 관심종목에서 삭제했습니다.`);
}

// 환율 조회 함수
async function showExchangeRate(chatId) {
  try {
    const quote = await yahooFinance.quote('USDKRW=X');
    const rate = quote?.regularMarketPrice;
    const change = quote?.regularMarketChange || 0;
    const changePercent = quote?.regularMarketChangePercent || 0;

    if (!rate) {
      bot.sendMessage(chatId, '❌ 환율 정보를 가져올 수 없습니다.');
      return;
    }

    const arrow = change >= 0 ? '🔺' : '🔻';
    const sign = change >= 0 ? '+' : '';

    const message = `💱 USD/KRW 환율
━━━━━━━━━━━━━━━
₩${formatNumber(Math.round(rate))}

${arrow} ${sign}${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)
━━━━━━━━━━━━━━━
💡 "1400원 알려줘" - 목표 환율 알림`;

    bot.sendMessage(chatId, message);
  } catch (error) {
    bot.sendMessage(chatId, '❌ 환율 정보를 가져올 수 없습니다.');
  }
}

// 환율 알림 설정 함수
async function setExchangeAlert(chatId, targetRate) {
  try {
    const currentRate = await getExchangeRate();
    if (!currentRate) {
      bot.sendMessage(chatId, '❌ 환율 정보를 가져올 수 없습니다.');
      return;
    }

    const direction = targetRate >= currentRate ? 'above' : 'below';
    const dirText = direction === 'above' ? '이상' : '이하';

    if (!exchangeAlerts[chatId]) exchangeAlerts[chatId] = [];
    exchangeAlerts[chatId].push({ targetRate, direction });

    bot.sendMessage(chatId, `🔔 환율 알림 설정 완료!\n\n💱 현재 환율: ₩${formatNumber(Math.round(currentRate))}\n🎯 목표 환율: ₩${formatNumber(targetRate)} ${dirText}\n\n목표 환율 도달 시 알림을 보내드립니다.`);
  } catch (error) {
    bot.sendMessage(chatId, '❌ 환율 알림 설정 실패');
  }
}

// 알림 설정 함수
async function setAlert(chatId, stockName, targetPrice) {
  const ticker = resolveTicker(stockName);

  try {
    const quote = await yahooFinance.quote(ticker);
    if (!quote || !quote.regularMarketPrice) {
      bot.sendMessage(chatId, `❌ "${stockName}" 티커를 찾을 수 없습니다.`);
      return;
    }

    const currentPrice = quote.regularMarketPrice;
    const direction = targetPrice >= currentPrice ? 'above' : 'below';
    const dirText = direction === 'above' ? '이상' : '이하';

    if (!alerts[chatId]) alerts[chatId] = [];
    alerts[chatId].push({ ticker, targetPrice, direction });

    const name = quote.shortName || ticker;
    const rate = await getExchangeRate();
    bot.sendMessage(chatId, `🔔 알림 설정 완료!\n\n${name} (${ticker})\n현재가: $${currentPrice.toFixed(2)} (₩${formatKRW(currentPrice, rate)})\n목표가: $${targetPrice} ${dirText}\n\n목표가 도달 시 알림을 보내드립니다.`);
  } catch (error) {
    bot.sendMessage(chatId, `❌ "${stockName}" 알림 설정 실패`);
  }
}

// 알림 삭제 함수
function delAlert(chatId, index) {
  if (!alerts[chatId] || !alerts[chatId][index]) {
    bot.sendMessage(chatId, '❌ 해당 알림을 찾을 수 없습니다.');
    return;
  }

  const removed = alerts[chatId].splice(index, 1)[0];
  bot.sendMessage(chatId, `🗑️ ${removed.ticker} $${removed.targetPrice} 알림을 삭제했습니다.`);
}

// 주가 조회 함수 (종합 분석 리포트)
async function getQuote(chatId, stockName) {
  const ticker = resolveTicker(stockName);

  try {
    const [quote, rsi, rate] = await Promise.all([
      yahooFinance.quote(ticker),
      calculateRSI(ticker),
      getExchangeRate(),
    ]);

    if (!quote || !quote.regularMarketPrice) {
      bot.sendMessage(chatId, `❌ "${stockName}" 티커를 찾을 수 없습니다.`);
      return;
    }

    const price = quote.regularMarketPrice;
    const change = quote.regularMarketChange || 0;
    const changePercent = quote.regularMarketChangePercent || 0;
    const name = quote.shortName || ticker;

    const arrow = change >= 0 ? '🔺' : '🔻';
    const sign = change >= 0 ? '+' : '';

    const week52High = quote.fiftyTwoWeekHigh;
    const week52Low = quote.fiftyTwoWeekLow;

    const volume = quote.regularMarketVolume;
    const avgVolume = quote.averageDailyVolume3Month;

    const dividendYield = quote.dividendYield;
    const dividendRate = quote.dividendRate;
    const dividendDate = quote.dividendDate;

    const rsiComment = getRSIComment(rsi);

    let message = `📊 ${name} (${ticker})
━━━━━━━━━━━━━━━

💵 현재가
$${price.toFixed(2)} (₩${formatKRW(price, rate)})
${arrow} ${sign}${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)

📈 기술 지표
RSI(14): ${rsi !== null ? rsi.toFixed(1) : '-'} ${rsiComment}

📉 52주 범위
최고: $${week52High?.toFixed(2) || '-'} (₩${week52High ? formatKRW(week52High, rate) : '-'})
최저: $${week52Low?.toFixed(2) || '-'} (₩${week52Low ? formatKRW(week52Low, rate) : '-'})

📊 거래량
${formatNumber(volume)}주
평균(3개월): ${formatNumber(avgVolume)}주`;

    if (dividendYield || dividendRate) {
      message += `\n\n💰 배당 정보`;
      if (dividendYield) {
        message += `\n배당수익률: ${dividendYield.toFixed(2)}%`;
      }
      if (dividendRate) {
        message += `\n연간배당금: $${dividendRate.toFixed(2)} (₩${formatKRW(dividendRate, rate)})`;
      }
      if (dividendDate) {
        const divDate = new Date(dividendDate);
        message += `\n배당일: ${divDate.toLocaleDateString('ko-KR')}`;
      }
    }

    message += `\n\n━━━━━━━━━━━━━━━
💱 환율: $1 = ₩${formatNumber(Math.round(rate))}`;

    bot.sendMessage(chatId, message);
  } catch (error) {
    bot.sendMessage(chatId, `❌ "${stockName}" 정보를 가져올 수 없습니다.`);
  }
}

// 메시지 핸들러
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const input = msg.text?.trim();

  if (!input || input.startsWith('/')) return;

  const intent = parseIntent(input);

  switch (intent.type) {
    case 'testBriefing':
      bot.sendMessage(chatId, '⏳ 뉴스 브리핑 생성 중...');
      const briefing = await generateDailyBriefing();
      bot.sendMessage(chatId, briefing);
      break;
    case 'testDesign':
      bot.sendMessage(chatId, '⏳ 디자인 브리핑 생성 중...');
      const designBriefing = await generateDesignBriefing();
      bot.sendMessage(chatId, designBriefing);
      break;
    case 'showWatchlist':
      await showWatchlist(chatId);
      break;
    case 'showAlerts':
      showAlerts(chatId);
      break;
    case 'addWatchlist':
      await addToWatchlist(chatId, intent.stockName);
      break;
    case 'delWatchlist':
      delFromWatchlist(chatId, intent.stockName);
      break;
    case 'setAlert':
      await setAlert(chatId, intent.stockName, intent.targetPrice);
      break;
    case 'delAlert':
      delAlert(chatId, intent.index);
      break;
    case 'showExchangeRate':
      await showExchangeRate(chatId);
      break;
    case 'setExchangeAlert':
      await setExchangeAlert(chatId, intent.targetRate);
      break;
    case 'getQuote':
      await getQuote(chatId, intent.stockName);
      break;
  }
});
