import { addDaysISO, nextQuoteNumber, todayISO } from './domain.js';

export function createSeed(now = new Date()) {
  const issueDate = todayISO(now);
  const stamp = now.toISOString();

  const settings = {
    companyName: '好點子設計工作室',
    companyTaxId: '87654321',
    companyPhone: '0912-345-678',
    companyEmail: 'hello@goodidea.studio',
    companyAddress: '545 南投縣埔里鎮大學路 1 號',
    bankInfo: '玉山銀行（808）帳號 0123-456-789012',
    defaultTaxRate: 5,
    quotePrefix: 'Q',
    defaultTerms: [
      '1. 本報價單自報價日起 14 天內有效。',
      '2. 訂金 50%，尾款於驗收後 7 日內支付。',
      '3. 報價範圍外的追加需求，將另行估價。',
      '4. 來回修改以三次為限，超過部分依工時另計。',
    ].join('\n'),
  };

  const first = {
    id: 'seed-quote-001',
    number: nextQuoteNumber([], issueDate, settings.quotePrefix),
    status: 'sent',
    issueDate,
    validUntil: addDaysISO(issueDate, 14),
    client: {
      name: '日月潭文旅股份有限公司',
      contact: '林小姐',
      phone: '049-123-4567',
      email: 'lin@sunmoonlake-travel.tw',
      address: '555 南投縣魚池鄉中山路 100 號',
      taxId: '12345678',
    },
    projectName: '官方網站改版與線上訂房流程',
    items: [
      { description: '網站視覺設計（首頁、房型、活動頁）', qty: 1, unit: '式', unitPrice: 28000 },
      { description: '響應式前端切版', qty: 1, unit: '式', unitPrice: 32000 },
      { description: '訂房表單與後台管理功能', qty: 1, unit: '式', unitPrice: 45000 },
      { description: '上線教育訓練', qty: 2, unit: '小時', unitPrice: 1500 },
    ],
    discountType: 'amount',
    discountValue: 5000,
    taxRate: 5,
    deposit: 30000,
    notes: '希望於農曆年前上線，會提供既有網站素材與品牌規範。',
    terms: settings.defaultTerms,
    seller: { ...settings },
    createdAt: stamp,
    updatedAt: stamp,
  };

  const second = {
    id: 'seed-quote-002',
    number: nextQuoteNumber([first], issueDate, settings.quotePrefix),
    status: 'draft',
    issueDate,
    validUntil: addDaysISO(issueDate, 14),
    client: {
      name: '埔里咖啡實驗室',
      contact: '張先生',
      phone: '0988-765-432',
      email: 'hello@puli-coffee.tw',
      address: '545 南投縣埔里鎮中正路 88 號',
      taxId: '',
    },
    projectName: '品牌識別與開幕視覺',
    items: [
      { description: '品牌 Logo 設計（含二款提案）', qty: 1, unit: '式', unitPrice: 18000 },
      { description: '菜單與杯套視覺設計', qty: 1, unit: '式', unitPrice: 9000 },
      { description: '開幕主視覺與社群素材', qty: 1, unit: '式', unitPrice: 12000 },
    ],
    discountType: 'none',
    discountValue: 0,
    taxRate: 5,
    deposit: 0,
    notes: '預計下個月開幕，需先確認品牌方向。',
    terms: settings.defaultTerms,
    seller: { ...settings },
    createdAt: stamp,
    updatedAt: stamp,
  };

  return { settings, quotes: [first, second] };
}
