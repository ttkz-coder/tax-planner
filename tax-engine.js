/*
 * Tax Engine — คำนวณภาษีเงินได้บุคคลธรรมดา (ภ.ง.ด.90/91)
 * แยกออกมาจาก UI เพื่อให้ทดสอบได้ด้วย Node (`node tests/tax-engine.test.js`)
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.TaxEngine) และ CommonJS
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TaxEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // เพดานที่เปลี่ยนตามปีภาษี (พ.ศ.)
    const YEAR_RULES = {
        2568: {
            label: 'ปีภาษี 2568 (ยื่นต้นปี 2569)',
            sso: 9000,            // ฐานค่าจ้าง 15,000 x 5% x 12
            thaiEsg: 300000,      // Thai ESG 30% ของเงินได้ ไม่เกิน 300,000 (ถือ 5 ปี)
            esgxNew: 300000,      // ThaiESGX เงินลงทุนใหม่ (ซื้อ พ.ค.–มิ.ย. 2568)
            esgxLtf: 300000,      // ThaiESGX จากการสับเปลี่ยน LTF ปีแรก
            stimulus: 50000,      // Easy E-Receipt 2568
            homeBuild: 100000,    // ค่าก่อสร้างบ้านใหม่ (สัญญา 9 เม.ย. 67 – 31 ธ.ค. 68)
        },
        2569: {
            label: 'ปีภาษี 2569 (ยื่นต้นปี 2570)',
            sso: 10500,           // ฐานค่าจ้างใหม่ 17,500 x 5% x 12
            thaiEsg: 300000,
            esgxNew: 0,           // หมดช่วงซื้อแล้ว
            esgxLtf: 50000,       // สับเปลี่ยน LTF ปีที่ 2–5 ปีละ 50,000
            stimulus: 50000,      // ใส่เฉพาะเมื่อมีมาตรการของปีนั้น
            homeBuild: 0,         // มาตรการสิ้นสุด 31 ธ.ค. 2568
        },
    };
    const DEFAULT_YEAR = 2569;

    const BRACKETS = [
        { min: 0, max: 150000, rate: 0 },
        { min: 150000, max: 300000, rate: 0.05 },
        { min: 300000, max: 500000, rate: 0.10 },
        { min: 500000, max: 750000, rate: 0.15 },
        { min: 750000, max: 1000000, rate: 0.20 },
        { min: 1000000, max: 2000000, rate: 0.25 },
        { min: 2000000, max: 5000000, rate: 0.30 },
        { min: 5000000, max: Infinity, rate: 0.35 },
    ];

    const EMPTY_DATA = {
        year: DEFAULT_YEAR,
        salary: '', bonus: '', income402: '', income405: '', income408: '', withheldTax: '',
        status: 'single', children: '', children2018: '', parents: '', parentsHealthInsurance: '',
        disabledPersons: '', prenatal: '',
        socialSecurity: '', lifeInsurance: '', healthInsurance: '', spouseLife: '',
        providentFund: '', pensionInsurance: '', rmf: '', tesg: '', esgxNew: '', esgxLtf: '',
        mortgageInterest: '', shoppingStimulus: '', homeBuildCost: '', politicalDonation: '',
        doubleDonations: '', donations: '',
    };

    const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    };

    const rulesFor = (year) => YEAR_RULES[year] || YEAR_RULES[DEFAULT_YEAR];

    // รองรับแผนเก่าที่บันทึกไว้ (otherIncome + otherIncomeType, ssf)
    function migrate(raw) {
        const d = { ...EMPTY_DATA, ...(raw || {}) };
        if (raw && raw.otherIncome !== undefined && raw.income402 === undefined) {
            const key = { '402': 'income402', '405': 'income405', '408': 'income408' }[raw.otherIncomeType || '402'] || 'income402';
            d[key] = raw.otherIncome;
        }
        delete d.otherIncome; delete d.otherIncomeType; delete d.ssf;
        if (!YEAR_RULES[d.year]) d.year = DEFAULT_YEAR;
        return d;
    }

    function progressiveTax(netIncome) {
        let tax = 0;
        const details = [];
        BRACKETS.forEach((b, i) => {
            const taxable = Math.max(0, Math.min(netIncome, b.max) - b.min);
            const t = taxable * b.rate;
            tax += t;
            details.push({ index: i, min: b.min, max: b.max, rate: b.rate * 100, taxable, tax: t });
        });
        return { tax, details };
    }

    function bracketIndexOf(netIncome) {
        for (let i = BRACKETS.length - 1; i >= 0; i--) if (netIncome > BRACKETS[i].min) return i;
        return 0;
    }

    function calculate(input) {
        const d = migrate(input);
        const R = rulesFor(d.year);
        const married = d.status === 'married_no_income';

        // ---------- 1. เงินได้พึงประเมิน ----------
        const inc401 = num(d.salary) * 12 + num(d.bonus);
        const inc402 = num(d.income402);
        const inc405 = num(d.income405);
        const inc408 = num(d.income408);
        const totalIncome = inc401 + inc402 + inc405 + inc408;

        // ---------- 2. ค่าใช้จ่าย ----------
        // 40(1)+40(2) รวมกันหักได้ 50% ไม่เกิน 100,000
        const exp401_402 = Math.min((inc401 + inc402) * 0.5, 100000);
        const exp405 = inc405 * 0.30; // ให้เช่าบ้าน/อาคาร (เหมา 30%)
        const exp408 = inc408 * 0.60; // ธุรกิจ/ขายของ (เหมา 60%)
        const expenses = exp401_402 + exp405 + exp408;

        // ---------- 3. ค่าลดหย่อน ----------
        const items = [];
        const add = (key, label, group, amount) => { if (amount > 0) items.push({ key, label, group, amount }); return amount; };

        add('personal', 'ลดหย่อนส่วนตัว', 'family', 60000);
        add('spouse', 'คู่สมรสไม่มีเงินได้', 'family', married ? 60000 : 0);
        add('children', 'บุตร (คนแรก / เกิดก่อน 2561)', 'family', num(d.children) * 30000);
        add('children2018', 'บุตรคนที่ 2+ (เกิดตั้งแต่ 2561)', 'family', num(d.children2018) * 60000);
        add('parents', 'อุปการะบิดามารดา', 'family', Math.min(num(d.parents), married ? 4 : 2) * 30000);
        add('parentsHealth', 'ประกันสุขภาพบิดามารดา', 'family', Math.min(num(d.parentsHealthInsurance), 15000));
        add('disabled', 'อุปการะผู้พิการ', 'family', num(d.disabledPersons) * 60000);
        add('prenatal', 'ฝากครรภ์และคลอดบุตร', 'family', Math.min(num(d.prenatal), 60000));

        add('sso', 'ประกันสังคม', 'insurance', Math.min(num(d.socialSecurity), R.sso));
        const health = Math.min(num(d.healthInsurance), 25000);
        const lifeHealth = Math.min(num(d.lifeInsurance) + health, 100000);
        // เบี้ยบำนาญใช้สิทธิในโควตาประกันชีวิตที่เหลือก่อน แล้วค่อยไปโควตาบำนาญ (15% ไม่เกิน 200,000)
        const pensionIn = num(d.pensionInsurance);
        const pensionInLife = Math.min(pensionIn, 100000 - lifeHealth);
        const lifeTotal = add('life', 'ประกันชีวิต / สุขภาพตนเอง', 'insurance', lifeHealth + pensionInLife);
        add('spouseLife', 'ประกันชีวิตคู่สมรส', 'insurance', married ? Math.min(num(d.spouseLife), 10000) : 0);

        const pensionCap = Math.min(totalIncome * 0.15, 200000);
        const pension = Math.min(pensionIn - pensionInLife, pensionCap);
        const pvd = Math.min(num(d.providentFund), inc401 * 0.15, 500000);
        const rmfCap = Math.min(totalIncome * 0.30, 500000);
        const rmf = Math.min(num(d.rmf), rmfCap);
        const retireRaw = pvd + pension + rmf;
        const retire = add('retire', 'กลุ่มเกษียณ (PVD/RMF/บำนาญ)', 'invest', Math.min(retireRaw, 500000));

        const tesgCap = Math.min(totalIncome * 0.30, R.thaiEsg);
        const tesg = add('tesg', 'กองทุน Thai ESG', 'invest', Math.min(num(d.tesg), tesgCap));
        add('esgxNew', 'ThaiESGX (เงินใหม่)', 'invest', Math.min(num(d.esgxNew), R.esgxNew));
        add('esgxLtf', 'ThaiESGX (สับเปลี่ยน LTF)', 'invest', Math.min(num(d.esgxLtf), R.esgxLtf));

        add('mortgage', 'ดอกเบี้ยเงินกู้ซื้อบ้าน', 'stimulus', Math.min(num(d.mortgageInterest), 100000));
        add('stimulus', 'มาตรการกระตุ้นเศรษฐกิจ', 'stimulus', Math.min(num(d.shoppingStimulus), R.stimulus));
        add('homeBuild', 'ค่าก่อสร้างบ้านใหม่', 'stimulus', Math.min(Math.floor(num(d.homeBuildCost) / 1000000) * 10000, R.homeBuild));
        add('political', 'บริจาคพรรคการเมือง', 'stimulus', Math.min(num(d.politicalDonation), 10000));

        const preDonation = items.reduce((s, i) => s + i.amount, 0);
        const netBeforeDonation = Math.max(0, totalIncome - expenses - preDonation);

        // เงินบริจาค: x2 ก่อน แล้วจึงบริจาคทั่วไป แต่ละส่วนไม่เกิน 10% ของเงินได้หลังหักลดหย่อน
        const doubleDon = add('doubleDon', 'บริจาคการศึกษา/กีฬา/รพ.รัฐ (x2)', 'donation', Math.min(num(d.doubleDonations) * 2, netBeforeDonation * 0.10));
        const afterDouble = netBeforeDonation - doubleDon;
        const genDon = add('genDon', 'บริจาคทั่วไป', 'donation', Math.min(num(d.donations), afterDouble * 0.10));

        const allowances = preDonation + doubleDon + genDon;
        const netIncome = Math.max(0, afterDouble - genDon);

        // ---------- 4. ภาษี ----------
        const prog = progressiveTax(netIncome);
        // ม.48(2): เงินได้ 40(2)–40(8) รวม ≥ 120,000 คิด 0.5% — ถ้าเกิน 5,000 และสูงกว่าวิธีปกติ ให้เสียตามนี้
        const otherIncome = inc402 + inc405 + inc408;
        const minimumTax = otherIncome >= 120000 ? otherIncome * 0.005 : 0;
        const minTaxApplied = minimumTax > 5000 && minimumTax > prog.tax;
        const tax = minTaxApplied ? minimumTax : prog.tax;

        const idx = bracketIndexOf(netIncome);
        const next = BRACKETS[idx + 1];
        const wht = num(d.withheldTax);
        const balance = tax - wht;

        // เงินเหลือจริง (ประมาณการ) = รายได้ - ภาษี - ประกันสังคม - PVD
        const takeHome = totalIncome - tax - Math.min(num(d.socialSecurity), R.sso) - num(d.providentFund);

        return {
            year: d.year, rules: R, data: d,
            income: { inc401, inc402, inc405, inc408, totalIncome, otherIncome },
            expenses: { total: expenses, exp401_402, exp405, exp408 },
            allowanceItems: items, allowances,
            netIncome, tax, progressiveTax: prog.tax, minimumTax, minTaxApplied,
            brackets: prog.details,
            marginalRate: BRACKETS[idx].rate * 100,
            nextBracket: next ? { gap: next.min - netIncome, rate: next.rate * 100 } : null,
            effectiveRate: totalIncome > 0 ? (tax / totalIncome) * 100 : 0,
            wht, balance, isRefund: balance < 0,
            takeHome, takeHomeMonthly: takeHome / 12,
            // ใช้คำนวณโควตาที่เหลือ
            usage: { lifeTotal, pension, pensionCap, rmf, rmfCap, retire, tesg, tesgCap },
        };
    }

    // ห้องว่างของแต่ละสิทธิ ที่ยังซื้อเพิ่มได้ในปีนี้
    function rooms(c) {
        const d = c.data, u = c.usage;
        const retireRoom = Math.max(0, 500000 - u.retire);
        const rmfRoom = Math.max(0, Math.min(u.rmfCap - num(d.rmf), retireRoom));
        const pensionRoom = Math.max(0, Math.min(u.pensionCap - u.pension, retireRoom));
        return {
            life: Math.max(0, 100000 - u.lifeTotal),
            rmf: rmfRoom,
            pension: pensionRoom,
            tesg: Math.max(0, u.tesgCap - num(d.tesg)),
        };
    }

    const LEVERS = [
        { key: 'tesg', field: 'tesg', label: 'กองทุน Thai ESG', note: 'ถือครอง 5 ปีเต็ม', color: '#f59e0b' },
        { key: 'rmf', field: 'rmf', label: 'กองทุน RMF', note: 'ถือ 5 ปี และจนอายุ 55', color: '#14b8a6' },
        { key: 'life', field: 'lifeInsurance', label: 'ประกันชีวิต (สัญญา 10 ปี+)', note: 'ได้ความคุ้มครองด้วย', color: '#3b82f6' },
        { key: 'pension', field: 'pensionInsurance', label: 'ประกันบำนาญ', note: 'จ่ายเบี้ยถึงอายุ 55+', color: '#a855f7' },
    ];

    // จำลองว่าถ้าเติมแต่ละสิทธิเต็มเพดาน จะประหยัดภาษีได้เท่าไหร่ + กรณีเติมทุกอย่าง
    function optimize(input) {
        const base = calculate(input);
        const r = rooms(base);
        const levers = LEVERS.map((l) => {
            // ลดหย่อนเกินกว่าที่ทำให้เงินได้สุทธิต่ำกว่า 150,000 ก็ไม่ได้ช่วยอะไรแล้ว
            const room = Math.min(r[l.key], Math.max(0, base.netIncome - 150000));
            if (room <= 0) return { ...l, room: 0, saving: 0, roi: 0 };
            const tried = calculate({ ...base.data, [l.field]: num(base.data[l.field]) + room });
            const saving = Math.max(0, base.tax - tried.tax);
            return { ...l, room, saving, roi: saving / room };
        }).sort((a, b) => b.roi - a.roi || b.saving - a.saving);

        // Best case: เติมตามลำดับความคุ้ม (ห้องของ RMF/บำนาญ แชร์เพดาน 500,000 กัน จึงคำนวณใหม่ทีละขั้น)
        let data = { ...base.data };
        const plan = [];
        for (const l of levers) {
            const cur = calculate(data);
            const room = Math.min(rooms(cur)[l.key], Math.max(0, cur.netIncome - 150000));
            if (room <= 0) continue;
            const nextData = { ...data, [l.field]: num(data[l.field]) + room };
            const saving = cur.tax - calculate(nextData).tax;
            if (saving <= 0) continue; // ไม่ช่วยลดภาษีแล้ว ไม่ต้องซื้อ
            plan.push({ ...l, amount: room, saving });
            data = nextData;
        }
        const best = calculate(data);
        return {
            base, levers, plan,
            bestTax: best.tax,
            totalSaving: base.tax - best.tax,
            investmentNeeded: plan.reduce((s, p) => s + p.amount, 0),
        };
    }

    return { YEAR_RULES, DEFAULT_YEAR, BRACKETS, EMPTY_DATA, calculate, optimize, rooms, migrate, progressiveTax };
});
