// รันด้วย: node tests/tax-engine.test.js
const assert = require('assert');
const T = require('../tax-engine.js');
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('✓', name); };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} != ${b}`);

t('ขั้นบันไดภาษี', () => {
    close(T.progressiveTax(150000).tax, 0, '150k');
    close(T.progressiveTax(300000).tax, 7500, '300k');
    close(T.progressiveTax(500000).tax, 27500, '500k');
    close(T.progressiveTax(750000).tax, 65000, '750k');
    close(T.progressiveTax(1000000).tax, 115000, '1M');
    close(T.progressiveTax(2000000).tax, 365000, '2M');
    close(T.progressiveTax(5000000).tax, 1265000, '5M');
    close(T.progressiveTax(6000000).tax, 1615000, '6M');
});

t('พนักงานเงินเดือน 50,000 + ประกันสังคม', () => {
    const c = T.calculate({ year: 2568, salary: 50000, socialSecurity: 9000 });
    close(c.income.totalIncome, 600000, 'income');
    close(c.expenses.total, 100000, 'expense cap');
    close(c.netIncome, 600000 - 100000 - 60000 - 9000, 'net');
    close(c.tax, T.progressiveTax(431000).tax, 'tax');
    assert.strictEqual(c.marginalRate, 10);
});

t('ประกันสังคมปี 2569 เพดาน 10,500', () => {
    const c = T.calculate({ year: 2569, salary: 50000, socialSecurity: 12000 });
    assert.strictEqual(c.allowanceItems.find(i => i.key === 'sso').amount, 10500);
});

t('40(1)+40(2) แชร์เพดานค่าใช้จ่าย 100,000', () => {
    const c = T.calculate({ salary: 10000, income402: 200000 });
    close(c.expenses.total, 100000, 'shared cap');
});

t('40(8) หัก 60% และ 40(5) หัก 30% แยกจาก 40(1)', () => {
    const c = T.calculate({ salary: 30000, income405: 100000, income408: 100000 });
    close(c.expenses.total, 100000 + 30000 + 60000, 'expenses');
});

t('บิดามารดา: โสดได้ 2 คน, คู่สมรสไม่มีเงินได้ได้ 4 คน', () => {
    const s = T.calculate({ salary: 50000, parents: 4 });
    const m = T.calculate({ salary: 50000, parents: 4, status: 'married_no_income' });
    assert.strictEqual(s.allowanceItems.find(i => i.key === 'parents').amount, 60000);
    assert.strictEqual(m.allowanceItems.find(i => i.key === 'parents').amount, 120000);
});

t('ประกันชีวิต+สุขภาพ ไม่เกิน 100,000 และบำนาญล้นเข้าโควตาชีวิต', () => {
    const c = T.calculate({ salary: 100000, healthInsurance: 40000, lifeInsurance: 50000, pensionInsurance: 50000 });
    // health 25k + life 50k = 75k, บำนาญเติมได้อีก 25k, ที่เหลือ 25k เข้ากลุ่มเกษียณ
    assert.strictEqual(c.usage.lifeTotal, 100000);
    assert.strictEqual(c.usage.pension, 25000);
});

t('PVD ไม่เกิน 15% ของค่าจ้าง และกลุ่มเกษียณรวมไม่เกิน 500,000', () => {
    const c = T.calculate({ salary: 100000, providentFund: 500000, rmf: 500000 });
    assert.strictEqual(c.usage.retire, 500000);
    const p = T.calculate({ salary: 10000, providentFund: 100000 });
    close(p.allowanceItems.find(i => i.key === 'retire').amount, 18000, 'pvd 15%');
});

t('Thai ESG 30% ไม่เกิน 300,000', () => {
    const c = T.calculate({ salary: 50000, tesg: 500000 });
    assert.strictEqual(c.usage.tesg, 180000);
});

t('ThaiESGX: 2568 เงินใหม่ 300k, 2569 ไม่มีเงินใหม่ / LTF 50k', () => {
    const a = T.calculate({ year: 2568, salary: 200000, esgxNew: 400000, esgxLtf: 400000 });
    const b = T.calculate({ year: 2569, salary: 200000, esgxNew: 400000, esgxLtf: 400000 });
    assert.strictEqual(a.allowanceItems.find(i => i.key === 'esgxNew').amount, 300000);
    assert.strictEqual(a.allowanceItems.find(i => i.key === 'esgxLtf').amount, 300000);
    assert.ok(!b.allowanceItems.find(i => i.key === 'esgxNew'));
    assert.strictEqual(b.allowanceItems.find(i => i.key === 'esgxLtf').amount, 50000);
});

t('สร้างบ้าน: 10,000 ต่อทุก 1 ล้าน เฉพาะปี 2568', () => {
    const a = T.calculate({ year: 2568, salary: 100000, homeBuildCost: 2500000 });
    assert.strictEqual(a.allowanceItems.find(i => i.key === 'homeBuild').amount, 20000);
    const b = T.calculate({ year: 2569, salary: 100000, homeBuildCost: 2500000 });
    assert.ok(!b.allowanceItems.find(i => i.key === 'homeBuild'));
});

t('เงินบริจาค x2 และทั่วไป ไม่เกิน 10%', () => {
    const c = T.calculate({ salary: 50000, doubleDonations: 100000, donations: 100000 });
    const base = 600000 - 100000 - 60000; // 440,000
    const dbl = base * 0.1;
    const gen = (base - dbl) * 0.1;
    close(c.netIncome, base - dbl - gen, 'net after donations');
});

t('ภาษีขั้นต่ำ 0.5% ม.48(2)', () => {
    const c = T.calculate({ income408: 3000000 });
    // net = 3M - 1.8M - 60k = 1.14M -> progressive 150,000 > 15,000 => ใช้วิธีปกติ
    assert.strictEqual(c.minTaxApplied, false);
    const d = T.calculate({ income408: 3000000, rmf: 900000, tesg: 900000, lifeInsurance: 100000, mortgageInterest: 100000 });
    // net ต่ำมาก -> 0.5% = 15,000 สูงกว่า
    assert.strictEqual(d.minTaxApplied, true);
    close(d.tax, 15000, 'min tax');
});

t('รองรับแผนเก่า otherIncome/otherIncomeType', () => {
    const c = T.calculate({ otherIncome: 800000, otherIncomeType: '408' });
    assert.strictEqual(c.income.inc408, 800000);
});

t('optimize: เติมถึงแค่เงินได้สุทธิ 150,000 และไม่ติดลบ', () => {
    const o = T.optimize({ salary: 30000, socialSecurity: 9000 });
    // net = 360k-100k-60k-9k = 191k -> ลดได้อีก 41k
    assert.ok(o.investmentNeeded <= 41000 + 1);
    close(o.bestTax, 0, 'best tax');
    assert.ok(o.totalSaving > 0);
    const z = T.optimize({ salary: 10000 });
    assert.strictEqual(z.plan.length, 0);
});

t('optimize: สายลงทุน — RMF กับบำนาญแชร์ 500k', () => {
    const o = T.optimize({ salary: 300000 });
    const retire = o.plan.filter(p => p.key === 'rmf' || p.key === 'pension').reduce((s, p) => s + p.amount, 0);
    assert.ok(retire <= 500000);
    assert.ok(o.bestTax < o.base.tax);
});

console.log(`\n${pass} tests passed`);
