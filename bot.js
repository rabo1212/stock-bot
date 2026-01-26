const TelegramBot = require('node-telegram-bot-api');
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const axios = require('axios');

// 환경변수에서 토큰 가져오기 (Railway 배포용)
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8576664680:AAEYh0jk2rOMQE4XZVg4ISUBqMLmyeLHgZ0';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

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

  // === 인터넷 / 이커머스 ===
  '넷플릭스': 'NFLX', '우버': 'UBER', '에어비앤비': 'ABNB',
  '부킹홀딩스': 'BKNG', '메르카도리브레': 'MELI', '쇼피파이': 'SHOP',
  '핀터레스트': 'PINS', '스냅': 'SNAP', '로블록스': 'RBLX',
  '이베이': 'EBAY', '엣시': 'ETSY', '도어대시': 'DASH',
  '스포티파이': 'SPOT', '트립어드바이저': 'TRIP', '익스피디아': 'EXPE',
  '치웨이': 'CHWY', '카바나': 'CVNA', '줌인포': 'ZI',

  // === 통신 / 미디어 ===
  '디즈니': 'DIS', '컴캐스트': 'CMCSA', '버라이즌': 'VZ',
  'AT&T': 'T', '에이티앤티': 'T', '티모바일': 'TMUS',
  '워너브라더스': 'WBD', '파라마운트': 'PARA', '폭스': 'FOXA',
  '차터커뮤니케이션즈': 'CHTR', 'EA': 'EA', '일렉트로닉아츠': 'EA',
  '테이크투': 'TTWO', '액티비전': 'ATVI', '유니티': 'U',

  // === 금융 - 은행 ===
  'JP모건': 'JPM', 'JP모간': 'JPM', '제이피모건': 'JPM',
  '뱅크오브아메리카': 'BAC', 'BOA': 'BAC', '웰스파고': 'WFC',
  '씨티그룹': 'C', '씨티은행': 'C', '골드만삭스': 'GS',
  '모건스탠리': 'MS', 'US뱅코프': 'USB', 'PNC': 'PNC',
  '트루이스트': 'TFC', '캐피탈원': 'COF', '찰스슈왑': 'SCHW',

  // === 금융 - 카드/결제 ===
  '비자': 'V', '마스터카드': 'MA', '아메리칸익스프레스': 'AXP', '아멕스': 'AXP',
  '페이팔': 'PYPL', '블록': 'SQ', '스퀘어': 'SQ', '피델리티': 'FIS',
  '피서브': 'FI', '글로벌페이먼츠': 'GPN', '애드옌': 'ADYEN',

  // === 금융 - 보험/자산운용 ===
  '버크셔헤서웨이': 'BRK-B', '블랙록': 'BLK', '스테이트스트리트': 'STT',
  '프로그레시브': 'PGR', '메트라이프': 'MET', '에이플락': 'AFL',
  '트래블러스': 'TRV', 'AIG': 'AIG', '프루덴셜': 'PRU',
  '올스테이트': 'ALL', '하트포드': 'HIG', '마쉬앤맥레넌': 'MMC',
  '에이온': 'AON', '아서제이갤러거': 'AJG', 'CME그룹': 'CME',
  '인터컨티넨탈익스체인지': 'ICE', '나스닥': 'NDAQ', 'MSCI': 'MSCI',
  'S&P글로벌': 'SPGI', '무디스': 'MCO', 'T로우프라이스': 'TROW',

  // === 헬스케어 - 제약 ===
  '일라이릴리': 'LLY', '릴리': 'LLY', '존슨앤존슨': 'JNJ', 'J&J': 'JNJ',
  '머크': 'MRK', '애브비': 'ABBV', '화이자': 'PFE', '노바티스': 'NVS',
  '아스트라제네카': 'AZN', '브리스톨마이어스': 'BMY', '암젠': 'AMGN',
  '길리어드': 'GILD', '리제네론': 'REGN', '버텍스': 'VRTX',
  '모더나': 'MRNA', '바이오젠': 'BIIB', '일루미나': 'ILMN',
  '시젠': 'SGEN', '알나일람': 'ALNY', '바이오마린': 'BMRN',
  '사렙타': 'SRPT', '호라이즌테라퓨틱스': 'HZNP', '조에티스': 'ZTS',

  // === 헬스케어 - 의료기기/서비스 ===
  '유나이티드헬스': 'UNH', '유헬스': 'UNH', '써모피셔': 'TMO',
  '애보트': 'ABT', '다나허': 'DHR', '메드트로닉': 'MDT',
  '인튜이티브서지컬': 'ISRG', '다빈치': 'ISRG', '스트라이커': 'SYK',
  '에드워즈라이프사이언스': 'EW', '보스턴사이언티픽': 'BSX',
  '벡톤디킨슨': 'BDX', '아이덱스': 'IDXX', 'HCA헬스케어': 'HCA',
  '시그나': 'CI', '엘리반스헬스': 'ELV', '앤섬': 'ELV',
  '센틴': 'CNC', '몰리나헬스케어': 'MOH', '험아나': 'HUM',
  'CVS헬스': 'CVS', '맥케슨': 'MCK', '아메리소스버겐': 'ABC',
  '카디널헬스': 'CAH', '랩코프': 'LH', '퀘스트다이어그노스틱스': 'DGX',
  '쿠퍼컴퍼니스': 'COO', '알라인테크놀로지': 'ALGN', '덱스컴': 'DXCM',

  // === 소비재 - 필수소비재 ===
  '월마트': 'WMT', '코스트코': 'COST', '프록터앤갬블': 'PG', 'P&G': 'PG',
  '코카콜라': 'KO', '펩시코': 'PEP', '펩시': 'PEP',
  '필립모리스': 'PM', '알트리아': 'MO', '몬델리즈': 'MDLZ',
  '콜게이트팜올리브': 'CL', '킴벌리클라크': 'KMB', '제너럴밀스': 'GIS',
  '켈로그': 'K', '크래프트하인즈': 'KHC', '허쉬': 'HSY',
  '맥코믹': 'MKC', '처치앤드와이트': 'CHD', '클로록스': 'CLX',
  '에스티로더': 'EL', '타겟': 'TGT', '달러제너럴': 'DG',
  '달러트리': 'DLTR', '크로거': 'KR', '시스코푸드': 'SYY',
  '월그린': 'WBA', '콘아그라': 'CAG', '호멜푸드': 'HRL',

  // === 소비재 - 임의소비재 ===
  '맥도날드': 'MCD', '스타벅스': 'SBUX', '나이키': 'NKE',
  '홈디포': 'HD', '로우스': 'LOW', 'TJ맥스': 'TJX', 'TJX': 'TJX',
  '로스스토어스': 'ROST', '치폴레': 'CMG', '얌브랜즈': 'YUM',
  '도미노피자': 'DPZ', '대런레스토랑': 'DRI', '힐튼': 'HLT',
  '메리어트': 'MAR', '라스베이거스샌즈': 'LVS', 'MGM리조트': 'MGM',
  '카니발': 'CCL', '로얄캐리비안': 'RCL', '노르웨이지안크루즈': 'NCLH',
  '룰루레몬': 'LULU', '갭': 'GPS', '랄프로렌': 'RL',
  'PVH': 'PVH', '태피스트리': 'TPR', '풋로커': 'FL',
  '포드': 'F', 'GM': 'GM', '제너럴모터스': 'GM',
  '리비안': 'RIVN', '루시드': 'LCID', '오라일리': 'ORLY',
  '어드밴스오토파츠': 'AAP', '오토존': 'AZO', '카맥스': 'KMX',
  '펄트그룹': 'PHM', 'DR호튼': 'DHI', '레나': 'LEN', '톨브라더스': 'TOL',
  '베스트바이': 'BBY', '윌리엄스소노마': 'WSM', '와이풀': 'WHR',

  // === 산업재 ===
  '캐터필러': 'CAT', '디어': 'DE', '존디어': 'DE',
  '유니온퍼시픽': 'UNP', 'CSX': 'CSX', '노퍽서던': 'NSC',
  'UPS': 'UPS', '페덱스': 'FDX', 'XPO': 'XPO',
  '보잉': 'BA', '록히드마틴': 'LMT', '레이시온': 'RTX',
  '노스롭그루먼': 'NOC', '제너럴다이내믹스': 'GD', 'L3해리스': 'LHX',
  '하니웰': 'HON', '3M': 'MMM', '쓰리엠': 'MMM',
  '제너럴일렉트릭': 'GE', 'GE': 'GE', 'GE에어로스페이스': 'GE',
  '일리노이툴웍스': 'ITW', '에머슨일렉트릭': 'EMR', '파카하니핀': 'PH',
  '이튼': 'ETN', '록웰오토메이션': 'ROK', '포티브': 'FTV',
  '페이첵스': 'PAYX', 'ADP': 'ADP', '신타스': 'CTAS',
  '롤린스': 'ROL', '리퍼블릭서비시스': 'RSG', '웨이스트매니지먼트': 'WM',
  '코파트': 'CPRT', '버티브': 'VRT', '트레인테크놀로지스': 'TT',
  '캐리어글로벌': 'CARR', '오티스': 'OTIS', '스탠리블랙앤데커': 'SWK',

  // === 에너지 ===
  '엑손모빌': 'XOM', '셰브론': 'CVX', '코노코필립스': 'COP',
  '슐럼버거': 'SLB', 'EOG리소시스': 'EOG', '파이어니어내추럴': 'PXD',
  '옥시덴탈페트롤리엄': 'OXY', '마라톤페트롤리엄': 'MPC',
  '발레로에너지': 'VLO', '필립스66': 'PSX', '윌리엄스컴퍼니스': 'WMB',
  '킨더모건': 'KMI', '원오케이': 'OKE', 'MPLX': 'MPLX',
  '다이아몬드백에너지': 'FANG', '데본에너지': 'DVN', '헤스': 'HES',
  '코테라에너지': 'CTRA', 'APA': 'APA', '할리버튼': 'HAL',
  '베이커휴즈': 'BKR', '첸니어에너지': 'LNG',

  // === 유틸리티 ===
  '넥스테라에너지': 'NEE', '듀크에너지': 'DUK', '서던컴퍼니': 'SO',
  '도미니언에너지': 'D', '아메리칸일렉트릭파워': 'AEP',
  '엑셀론': 'EXC', '셈프라': 'SRE', '피지이코프': 'PCG',
  '콘솔리데이티드에디슨': 'ED', '엔터지': 'ETR', 'WEC에너지': 'WEC',
  '엑셀에너지': 'XEL', '에버소스에너지': 'ES', '아메렌': 'AEE',
  'CMS에너지': 'CMS', 'DTE에너지': 'DTE', '퍼블릭서비스': 'PEG',
  '아메리칸워터웍스': 'AWK', '퍼스트에너지': 'FE',

  // === 부동산/리츠 ===
  '프롤로지스': 'PLD', '아메리칸타워': 'AMT', '크라운캐슬': 'CCI',
  '에퀴닉스': 'EQIX', '퍼블릭스토리지': 'PSA', '리얼티인컴': 'O',
  '디지털리얼티': 'DLR', 'SBA커뮤니케이션즈': 'SBAC',
  '웰타워': 'WELL', '사이먼프로퍼티': 'SPG', '아발론베이': 'AVB',
  '에퀴티레지덴셜': 'EQR', '벤타스': 'VTR', '엑스트라스페이스': 'EXR',
  '킴코리얼티': 'KIM', '리젠시센터스': 'REG', '보스톤프로퍼티스': 'BXP',
  '알렉산드리아리얼에스테이트': 'ARE', '인비테이션홈즈': 'INVH',

  // === 소재 ===
  '린데': 'LIN', '에어프로덕츠': 'APD', '셔윈윌리엄스': 'SHW',
  '에코랩': 'ECL', '듀폰': 'DD', '다우': 'DOW', 'PPG인더스트리스': 'PPG',
  '뉴몬트': 'NEM', '프리포트맥모란': 'FCX', '뉴코어': 'NUE',
  'CF인더스트리스': 'CF', '모자이크': 'MOS', 'LNG': 'LNG',
  '인터내셔널페이퍼': 'IP', '패키징코프오브아메리카': 'PKG',
  '알베말': 'ALB', '셀라니즈': 'CE', 'RPM인터내셔널': 'RPM',
  '볼코퍼레이션': 'BALL', '암코르': 'AMCR', '마틴마리에타': 'MLM',
  '벌컨머티리얼스': 'VMC',

  // === 기타 주요 기업 ===
  '시스코': 'CSCO', 'IBM': 'IBM', '액센츄어': 'ACN',
  '인포시스': 'INFY', '코그니전트': 'CTSH', '글로벌파운드리스': 'GFS',
  '마이크로칩테크놀로지': 'MCHP', '시게이트': 'STX', '웨스턴디지털': 'WDC',
  '넷앱': 'NTAP', '아리스타네트웍스': 'ANET', '주니퍼네트웍스': 'JNPR',
  '모토로라솔루션즈': 'MSI', '가민': 'GRMN', '제브라테크놀로지스': 'ZBRA',
  '케이스웨스턴': 'KEYS', '트림블': 'TRMB', '앰피놀': 'APH',
  'TE커넥티비티': 'TEL', '코닝': 'GLW', 'CDW': 'CDW',

  // === 금융 기술 / 핀테크 ===
  '코인베이스': 'COIN', '로빈후드': 'HOOD', '소파이': 'SOFI',
  '어펌': 'AFRM', '마루케타': 'MQ', '토스트': 'TOST',
  '빌닷컴': 'BILL', 'GXO로지스틱스': 'GXO',

  // === 중국 ADR ===
  '알리바바': 'BABA', '텐센트': 'TCEHY', '바이두': 'BIDU',
  'JD닷컴': 'JD', '징동': 'JD', '핀둬둬': 'PDD', '테무': 'PDD',
  '니오': 'NIO', '샤오펑': 'XPEV', '리오토': 'LI',
  '넷이즈': 'NTES', '빌리빌리': 'BILI', '트립닷컴': 'TCOM',
};

// 티커 변환 함수 (소문자 입력도 지원)
function resolveTicker(stockName) {
  // 1. 그대로 매핑에서 찾기 (한글명 등)
  if (koreanToTicker[stockName]) {
    return koreanToTicker[stockName];
  }
  // 2. 대문자로 변환 후 매핑에서 찾기 (amd -> AMD -> 'AMD')
  const upper = stockName.toUpperCase();
  if (koreanToTicker[upper]) {
    return koreanToTicker[upper];
  }
  // 3. 그냥 대문자로 반환 (직접 티커 입력)
  return upper;
}

// 관심종목 저장 (chatId별)
const watchlist = {};

// 목표가 알림 저장 (chatId별)
const alerts = {};

// 환율 알림 저장 (chatId별)
const exchangeAlerts = {};

// 일정 알림 저장 (chatId별)
const schedules = {};

// 환율 캐시 (5분마다 갱신)
let exchangeRateCache = { rate: 1450, lastUpdated: 0 };

// 환율 가져오기 (USD/KRW)
async function getExchangeRate() {
  const now = Date.now();
  // 5분 캐시
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
    startDate.setDate(startDate.getDate() - (period * 3)); // 충분한 데이터 확보

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

    // 가격 변화 계산
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    // 최근 period 개의 변화만 사용
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

// 자연어 파싱 함수들
function parseIntent(text) {
  // 관심종목 보기: "관심종목", "리스트", "목록", "내 종목"
  if (/^(관심\s*종목|리스트|목록|내\s*종목)$/.test(text)) {
    return { type: 'showWatchlist' };
  }

  // 알림 목록 보기: "알림 목록", "알림 리스트", "내 알림", "알림"
  if (/^(알림\s*목록|알림\s*리스트|내\s*알림|설정\s*알림)$/.test(text)) {
    return { type: 'showAlerts' };
  }

  // 관심종목 추가: "TSLA 추가", "테슬라 추가해줘", "애플 담아줘"
  const addMatch = text.match(/^(.+?)\s*(추가|담아|넣어|추가해줘|담아줘|넣어줘)$/);
  if (addMatch) {
    return { type: 'addWatchlist', stockName: addMatch[1].trim() };
  }

  // 관심종목 삭제: "TSLA 삭제", "테슬라 빼줘", "애플 제거"
  const delMatch = text.match(/^(.+?)\s*(삭제|빼줘|제거|빼|지워|지워줘)$/);
  if (delMatch) {
    return { type: 'delWatchlist', stockName: delMatch[1].trim() };
  }

  // 알림 삭제: "1번 알림 삭제", "알림 1 삭제", "1번 삭제"
  const delAlertMatch = text.match(/(?:알림\s*)?(\d+)\s*번?\s*(?:알림\s*)?(?:삭제|취소|제거)/);
  if (delAlertMatch) {
    return { type: 'delAlert', index: parseInt(delAlertMatch[1]) - 1 };
  }

  // 환율 조회: "환율", "달러", "원달러"
  if (/^(환율|달러|원달러|달러환율|USD|usd)$/.test(text)) {
    return { type: 'showExchangeRate' };
  }

  // 환율 알림: "1400원 되면 알려줘", "환율 1400 알려줘", "1350원 알림"
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

  // 목표가 알림: "테슬라 400 알려줘", "TSLA 400되면 알림", "애플 200 이상", "SOXL 30 alert"
  const alertPatterns = [
    /^(.+?)\s+(\d+\.?\d*)\s*(?:되면|도달하면|넘으면|내려가면|떨어지면)?\s*(?:알려줘|알림|알려|노티|알려줘요)/,
    /^(.+?)\s+(\d+\.?\d*)\s*(?:이상|이하|도달|돌파)/,
    /^([A-Za-z][A-Za-z0-9\-\.]*)\s+(\d+\.?\d*)\s*(?:alert|알림)?$/i,  // "SOXL 30", "soxl 30 alert"
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

  // 그 외는 주가 조회로 처리
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

console.log('Stock Bot is running...');

// /start 명령어
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `🤖 대장미주봇입니다!

📌 종목 분석
종목명 입력 (예: 애플, TSLA, aapl)
→ 현재가, RSI, 52주 고저, 배당 등
💡 모든 미국 티커 조회 가능 (NAK, SOXL 등)

📌 관심종목
"관심종목" - 목록 보기
"테슬라 추가" - 추가
"테슬라 삭제" - 삭제

📌 목표가 알림
"테슬라 400 알려줘" - 알림 설정
"알림 목록" - 설정된 알림 보기
"1번 삭제" - 알림 삭제

📌 환율
"환율" - 현재 달러/원 환율
"1400원 알려줘" - 목표 환율 알림

📰 뉴스 브리핑
"뉴스" - 오늘의 브리핑 보기
"디자인" - 디자인 브리핑 보기
⏰ 매일 오전 7시 자동 브리핑

📅 일정 알림 (NEW!)
"일정 금요일 19시 회의" - 일정 등록
"매주 금요일 7시 회의" - 반복 일정
"일정" - 일정 목록 보기
"일정 1번 삭제" - 삭제
⏰ 10분 전에 자동 알림!`);
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
    // 병렬로 데이터 가져오기
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

    // 52주 고저
    const week52High = quote.fiftyTwoWeekHigh;
    const week52Low = quote.fiftyTwoWeekLow;

    // 거래량
    const volume = quote.regularMarketVolume;
    const avgVolume = quote.averageDailyVolume3Month;

    // 배당 정보
    const dividendYield = quote.dividendYield; // 이미 % 단위
    const dividendRate = quote.dividendRate; // 연간 배당금
    const dividendDate = quote.dividendDate;

    // RSI 코멘트
    const rsiComment = getRSIComment(rsi);

    // 메시지 구성
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

    // 배당 정보 추가 (있는 경우만)
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

// ===== 뉴스 브리핑 기능 =====

// 브리핑 구독자 목록 (chatId 저장)
const briefingSubscribers = new Set();

// 뉴스 API 키 (NewsAPI.org - 무료 플랜)
const NEWS_API_KEY = process.env.NEWS_API_KEY || '2477d3aed09448d08d5a131c17d14761';

// 뉴스 가져오기 함수 (한국어)
async function fetchNews(query, category = null) {
  try {
    if (!NEWS_API_KEY) {
      return null;
    }

    let url;
    if (query) {
      // 한국어 검색어로 뉴스 검색
      url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=3&sortBy=publishedAt&language=ko&apiKey=${NEWS_API_KEY}`;
    } else if (category) {
      // 한국 뉴스 헤드라인
      url = `https://newsapi.org/v2/top-headlines?country=kr&category=${category}&pageSize=3&apiKey=${NEWS_API_KEY}`;
    } else {
      url = `https://newsapi.org/v2/top-headlines?country=kr&pageSize=3&apiKey=${NEWS_API_KEY}`;
    }

    const response = await axios.get(url, { timeout: 10000 });
    return response.data.articles || [];
  } catch (error) {
    return null;
  }
}

// 한국 뉴스 가져오기 (네이버 검색 API 또는 대체)
async function fetchKoreanNews(query) {
  try {
    if (!NEWS_API_KEY) return null;

    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=3&sortBy=publishedAt&language=ko&apiKey=${NEWS_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data.articles || [];
  } catch (error) {
    return null;
  }
}

// 시세 정보 가져오기 (비트코인, 금, 주요 지수)
async function getMarketData() {
  try {
    const symbols = ['BTC-USD', 'GLD', '^GSPC', '^IXIC', '^DJI', 'USDKRW=X'];
    const quotes = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          return await yahooFinance.quote(symbol);
        } catch {
          return null;
        }
      })
    );

    return {
      bitcoin: quotes[0],
      gold: quotes[1],
      sp500: quotes[2],
      nasdaq: quotes[3],
      dow: quotes[4],
      usdkrw: quotes[5],
    };
  } catch (error) {
    return null;
  }
}

// 뉴스 브리핑 생성
async function generateNewsBriefing() {
  let message = `📰 오늘의 브리핑\n`;
  message += `━━━━━━━━━━━━━━━\n`;
  message += `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}\n\n`;

  // 시장 데이터 가져오기
  const marketData = await getMarketData();

  if (marketData) {
    // 환율
    if (marketData.usdkrw) {
      const rate = marketData.usdkrw.regularMarketPrice;
      const change = marketData.usdkrw.regularMarketChangePercent || 0;
      const arrow = change >= 0 ? '🔺' : '🔻';
      message += `💵 환율 (USD/KRW)\n`;
      message += `₩${formatNumber(Math.round(rate))} ${arrow}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n\n`;
    }

    // 미국 증시
    message += `🇺🇸 미국 증시\n`;
    if (marketData.sp500) {
      const change = marketData.sp500.regularMarketChangePercent || 0;
      const arrow = change >= 0 ? '🔺' : '🔻';
      message += `S&P500: ${formatNumber(Math.round(marketData.sp500.regularMarketPrice))} ${arrow}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n`;
    }
    if (marketData.nasdaq) {
      const change = marketData.nasdaq.regularMarketChangePercent || 0;
      const arrow = change >= 0 ? '🔺' : '🔻';
      message += `나스닥: ${formatNumber(Math.round(marketData.nasdaq.regularMarketPrice))} ${arrow}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n`;
    }
    if (marketData.dow) {
      const change = marketData.dow.regularMarketChangePercent || 0;
      const arrow = change >= 0 ? '🔺' : '🔻';
      message += `다우: ${formatNumber(Math.round(marketData.dow.regularMarketPrice))} ${arrow}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n`;
    }
    message += `\n`;

    // 비트코인
    if (marketData.bitcoin) {
      const price = marketData.bitcoin.regularMarketPrice;
      const change = marketData.bitcoin.regularMarketChangePercent || 0;
      const arrow = change >= 0 ? '🔺' : '🔻';
      const rate = marketData.usdkrw?.regularMarketPrice || 1450;
      message += `₿ 비트코인\n`;
      message += `$${formatNumber(Math.round(price))} (₩${formatNumber(Math.round(price * rate))}) ${arrow}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n\n`;
    }

    // 금
    if (marketData.gold) {
      const price = marketData.gold.regularMarketPrice;
      const change = marketData.gold.regularMarketChangePercent || 0;
      const arrow = change >= 0 ? '🔺' : '🔻';
      message += `🥇 금 (GLD ETF)\n`;
      message += `$${price.toFixed(2)} ${arrow}${change >= 0 ? '+' : ''}${change.toFixed(2)}%\n\n`;
    }
  }

  // 뉴스 섹션 (API 키가 있는 경우에만)
  if (NEWS_API_KEY) {
    // 주요 뉴스 (한국)
    const topNews = await fetchNews(null, 'business');
    if (topNews && topNews.length > 0) {
      message += `📰 주요 뉴스 Top 3\n`;
      topNews.slice(0, 3).forEach((article, i) => {
        message += `${i + 1}. ${article.title?.slice(0, 60) || ''}...\n`;
      });
      message += `\n`;
    }

    // AI/테크 소식
    const techNews = await fetchNews('AI 인공지능 기술');
    if (techNews && techNews.length > 0) {
      message += `🤖 AI/테크 소식\n`;
      techNews.slice(0, 2).forEach((article, i) => {
        message += `• ${article.title?.slice(0, 50) || ''}...\n`;
      });
      message += `\n`;
    }

    // 부동산 뉴스
    const realEstateNews = await fetchNews('부동산 아파트 주택');
    if (realEstateNews && realEstateNews.length > 0) {
      message += `🏠 부동산 뉴스\n`;
      realEstateNews.slice(0, 2).forEach((article, i) => {
        message += `• ${article.title?.slice(0, 50) || ''}...\n`;
      });
      message += `\n`;
    }

    // 포토그래퍼 소식
    const photoNews = await fetchNews('사진 카메라 촬영');
    if (photoNews && photoNews.length > 0) {
      message += `📸 포토그래퍼 소식\n`;
      photoNews.slice(0, 2).forEach((article, i) => {
        message += `• ${article.title?.slice(0, 50) || ''}...\n`;
      });
      message += `\n`;
    }
  } else {
    message += `💡 뉴스 기능을 사용하려면 NEWS_API_KEY 환경변수를 설정하세요.\n`;
    message += `(https://newsapi.org 에서 무료 API 키 발급)\n\n`;
  }

  message += `━━━━━━━━━━━━━━━\n`;
  message += `🤖 대장미주봇 자동 브리핑`;

  return message;
}

// 디자인 브리핑 생성
async function generateDesignBriefing() {
  let message = `✨ 디자인 브리핑\n`;
  message += `━━━━━━━━━━━━━━━\n`;
  message += `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}\n\n`;

  // 디자인 뉴스 (API 키가 있는 경우)
  if (NEWS_API_KEY) {
    const designNews = await fetchNews('디자인 UI UX 피그마');
    if (designNews && designNews.length > 0) {
      message += `🎨 핫한 디자인 소식\n`;
      designNews.slice(0, 3).forEach((article, i) => {
        message += `${i + 1}. ${article.title?.slice(0, 55) || ''}...\n`;
      });
      message += `\n`;
    }
  }

  message += `🔗 디자인 참고 사이트\n`;
  message += `• Dribbble: dribbble.com\n`;
  message += `• Behance: behance.net\n`;
  message += `• Awwwards: awwwards.com\n`;
  message += `• Mobbin: mobbin.com\n`;
  message += `• Godly: godly.website\n`;
  message += `• Lapa Ninja: lapa.ninja\n\n`;

  message += `💡 트렌드 키워드\n`;
  message += `#Bento #Glassmorphism #3D #Microinteraction #DarkMode\n\n`;

  message += `━━━━━━━━━━━━━━━\n`;
  message += `🤖 대장미주봇 디자인 브리핑`;

  return message;
}

// 뉴스 브리핑 보내기
async function sendNewsBriefing(chatId) {
  try {
    bot.sendMessage(chatId, '⏳ 브리핑 생성 중...');
    const briefing = await generateNewsBriefing();
    bot.sendMessage(chatId, briefing);
  } catch (error) {
    bot.sendMessage(chatId, '❌ 브리핑 생성 실패');
  }
}

// 디자인 브리핑 보내기
async function sendDesignBriefing(chatId) {
  try {
    bot.sendMessage(chatId, '⏳ 디자인 브리핑 생성 중...');
    const briefing = await generateDesignBriefing();
    bot.sendMessage(chatId, briefing);
  } catch (error) {
    bot.sendMessage(chatId, '❌ 디자인 브리핑 생성 실패');
  }
}

// 모든 구독자에게 브리핑 전송
async function broadcastBriefing(type = 'news') {
  const briefing = type === 'design' ? await generateDesignBriefing() : await generateNewsBriefing();

  for (const chatId of briefingSubscribers) {
    try {
      bot.sendMessage(chatId, briefing);
    } catch (error) {
      // 전송 실패 시 구독자 목록에서 제거
      briefingSubscribers.delete(chatId);
    }
  }
}

// 스케줄러 설정 (한국 시간 기준)
// 매일 오전 7시 뉴스 브리핑 (UTC 22:00 = KST 07:00)
cron.schedule('0 22 * * *', () => {
  console.log('Sending daily news briefing...');
  broadcastBriefing('news');
});

// 격일 오전 7시 10분 디자인 브리핑 (UTC 22:10 = KST 07:10)
// 홀수 날짜에만 전송
cron.schedule('10 22 * * *', () => {
  const today = new Date().getDate();
  if (today % 2 === 1) {
    console.log('Sending design briefing...');
    broadcastBriefing('design');
  }
});

console.log('News briefing scheduler started.');

// ===== 일정 알림 기능 =====

// 요일 파싱
function parseDay(text) {
  const days = {
    '일요일': 0, '일': 0,
    '월요일': 1, '월': 1,
    '화요일': 2, '화': 2,
    '수요일': 3, '수': 3,
    '목요일': 4, '목': 4,
    '금요일': 5, '금': 5,
    '토요일': 6, '토': 6,
  };
  return days[text];
}

// 다음 해당 요일 날짜 계산
function getNextDayDate(dayOfWeek) {
  const now = new Date();
  const today = now.getDay();
  let daysUntil = dayOfWeek - today;
  if (daysUntil <= 0) daysUntil += 7;
  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntil);
  return nextDate;
}

// 일정 파싱 함수
function parseSchedule(text) {
  // 패턴들: "금요일 7시 회의", "매주 금요일 19:00 팀미팅", "내일 14시 약속"

  // 반복 일정: "매주 금요일 7시 회의"
  const repeatMatch = text.match(/매주\s*(월|화|수|목|금|토|일)요?일?\s*(\d{1,2})[:시]?\s*(\d{0,2})분?\s*(.+)/);
  if (repeatMatch) {
    const dayOfWeek = parseDay(repeatMatch[1]);
    const hour = parseInt(repeatMatch[2]);
    const minute = parseInt(repeatMatch[3]) || 0;
    const title = repeatMatch[4].trim();
    return { type: 'repeat', dayOfWeek, hour, minute, title };
  }

  // 일회성: "금요일 7시 회의" 또는 "금요일 19:00 회의"
  const onceMatch = text.match(/(월|화|수|목|금|토|일)요?일?\s*(\d{1,2})[:시]?\s*(\d{0,2})분?\s*(.+)/);
  if (onceMatch) {
    const dayOfWeek = parseDay(onceMatch[1]);
    const hour = parseInt(onceMatch[2]);
    const minute = parseInt(onceMatch[3]) || 0;
    const title = onceMatch[4].trim();
    return { type: 'once', dayOfWeek, hour, minute, title };
  }

  // 오늘/내일: "오늘 7시 회의", "내일 14시 약속"
  const todayMatch = text.match(/(오늘|내일)\s*(\d{1,2})[:시]?\s*(\d{0,2})분?\s*(.+)/);
  if (todayMatch) {
    const isToday = todayMatch[1] === '오늘';
    const hour = parseInt(todayMatch[2]);
    const minute = parseInt(todayMatch[3]) || 0;
    const title = todayMatch[4].trim();

    const date = new Date();
    if (!isToday) date.setDate(date.getDate() + 1);

    return {
      type: 'once',
      dayOfWeek: date.getDay(),
      hour,
      minute,
      title,
      specificDate: date
    };
  }

  return null;
}

// 일정 추가 함수
function addSchedule(chatId, scheduleData) {
  if (!schedules[chatId]) schedules[chatId] = [];

  const now = new Date();
  let nextAlarm;

  if (scheduleData.specificDate) {
    nextAlarm = new Date(scheduleData.specificDate);
    nextAlarm.setHours(scheduleData.hour, scheduleData.minute, 0, 0);
  } else {
    nextAlarm = getNextDayDate(scheduleData.dayOfWeek);
    nextAlarm.setHours(scheduleData.hour, scheduleData.minute, 0, 0);

    // 이미 지난 시간이면 다음 주로
    if (nextAlarm <= now) {
      nextAlarm.setDate(nextAlarm.getDate() + 7);
    }
  }

  const schedule = {
    id: Date.now(),
    title: scheduleData.title,
    dayOfWeek: scheduleData.dayOfWeek,
    hour: scheduleData.hour,
    minute: scheduleData.minute,
    repeat: scheduleData.type === 'repeat',
    nextAlarm: nextAlarm.getTime(),
    notified: false,
  };

  schedules[chatId].push(schedule);
  return schedule;
}

// 일정 목록 보기
function showSchedules(chatId) {
  if (!schedules[chatId] || schedules[chatId].length === 0) {
    return '📅 등록된 일정이 없습니다.\n\n"일정 금요일 19시 회의" 형식으로 추가하세요.';
  }

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  let result = '📅 등록된 일정\n━━━━━━━━━━━━━━━\n';

  schedules[chatId].forEach((s, index) => {
    const repeatIcon = s.repeat ? '🔁' : '📌';
    const dayName = dayNames[s.dayOfWeek];
    const time = `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`;
    const nextDate = new Date(s.nextAlarm);
    const dateStr = `${nextDate.getMonth() + 1}/${nextDate.getDate()}`;

    result += `${index + 1}. ${repeatIcon} ${s.repeat ? '매주 ' : ''}${dayName}요일 ${time}\n`;
    result += `   "${s.title}"\n`;
    result += `   다음 알림: ${dateStr}\n\n`;
  });

  result += '━━━━━━━━━━━━━━━\n삭제: "일정 1번 삭제"';
  return result;
}

// 일정 삭제
function deleteSchedule(chatId, index) {
  if (!schedules[chatId] || !schedules[chatId][index]) {
    return '❌ 해당 일정을 찾을 수 없습니다.';
  }

  const removed = schedules[chatId].splice(index, 1)[0];
  return `🗑️ "${removed.title}" 일정을 삭제했습니다.`;
}

// 일정 알림 체크 (매분 실행)
function checkScheduleAlerts() {
  const now = new Date();
  const nowTime = now.getTime();

  for (const chatId of Object.keys(schedules)) {
    const userSchedules = schedules[chatId];
    if (!userSchedules || userSchedules.length === 0) continue;

    for (let i = userSchedules.length - 1; i >= 0; i--) {
      const schedule = userSchedules[i];
      const alarmTime = schedule.nextAlarm;

      // 10분 전 알림 (9분~10분 전 사이에 알림)
      const tenMinBefore = alarmTime - 10 * 60 * 1000;
      const nineMinBefore = alarmTime - 9 * 60 * 1000;

      if (nowTime >= tenMinBefore && nowTime < nineMinBefore && !schedule.notified) {
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const time = `${schedule.hour.toString().padStart(2, '0')}:${schedule.minute.toString().padStart(2, '0')}`;

        bot.sendMessage(chatId, `⏰ 일정 알림!\n\n📌 "${schedule.title}"\n🕐 ${dayNames[schedule.dayOfWeek]}요일 ${time}\n\n⏳ 10분 후 시작됩니다!`);
        schedule.notified = true;
      }

      // 일정 시간이 지났으면
      if (nowTime >= alarmTime) {
        if (schedule.repeat) {
          // 반복 일정: 다음 주로 업데이트
          const nextAlarm = new Date(schedule.nextAlarm);
          nextAlarm.setDate(nextAlarm.getDate() + 7);
          schedule.nextAlarm = nextAlarm.getTime();
          schedule.notified = false;
        } else {
          // 일회성 일정: 삭제
          userSchedules.splice(i, 1);
        }
      }
    }
  }
}

// 매분 일정 체크
setInterval(checkScheduleAlerts, 60000);

console.log('Schedule reminder started.');

// 메시지 핸들러
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const input = msg.text?.trim();

  if (!input || input.startsWith('/')) return;

  // 브리핑 구독자 자동 등록
  briefingSubscribers.add(chatId);

  // 뉴스/디자인 브리핑 명령어 처리
  if (/^(뉴스|뉴스브리핑|오늘뉴스|브리핑|news)$/i.test(input)) {
    await sendNewsBriefing(chatId);
    return;
  }

  if (/^(디자인|디자인브리핑|design)$/i.test(input)) {
    await sendDesignBriefing(chatId);
    return;
  }

  // 일정 관련 명령어 처리
  // 일정 목록 보기
  if (/^(일정|일정\s*목록|일정\s*리스트|내\s*일정)$/.test(input)) {
    bot.sendMessage(chatId, showSchedules(chatId));
    return;
  }

  // 일정 삭제: "일정 1번 삭제"
  const scheduleDelMatch = input.match(/일정\s*(\d+)\s*번?\s*(삭제|취소|제거)/);
  if (scheduleDelMatch) {
    const index = parseInt(scheduleDelMatch[1]) - 1;
    bot.sendMessage(chatId, deleteSchedule(chatId, index));
    return;
  }

  // 일정 추가: "일정 금요일 7시 회의" 또는 "금요일 7시 회의 알려줘"
  const scheduleAddMatch = input.match(/^일정\s+(.+)/) || input.match(/(.+)\s+알려줘$/);
  if (scheduleAddMatch) {
    const scheduleText = scheduleAddMatch[1].replace(/알려줘$/, '').trim();
    const parsed = parseSchedule(scheduleText);

    if (parsed) {
      const schedule = addSchedule(chatId, parsed);
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const time = `${schedule.hour.toString().padStart(2, '0')}:${schedule.minute.toString().padStart(2, '0')}`;
      const nextDate = new Date(schedule.nextAlarm);
      const dateStr = `${nextDate.getMonth() + 1}월 ${nextDate.getDate()}일`;

      let msg = `✅ 일정이 등록되었습니다!\n\n`;
      msg += `📌 "${schedule.title}"\n`;
      msg += `🗓️ ${schedule.repeat ? '매주 ' : ''}${dayNames[schedule.dayOfWeek]}요일 ${time}\n`;
      msg += `⏰ 다음 알림: ${dateStr} ${time} (10분 전)\n`;
      if (schedule.repeat) msg += `🔁 매주 반복`;

      bot.sendMessage(chatId, msg);
      return;
    }
  }

  const intent = parseIntent(input);

  switch (intent.type) {
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
