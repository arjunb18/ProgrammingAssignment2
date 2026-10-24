// Vercel serverless function: proxies DHBVN's anonymous outage lookup and returns JSON.
// GET /api/outages?district=10&area=sector%2021a
const BASE = 'https://chs.dhbvn.org.in';
const HEADERS = {
  'content-type': 'application/json',
  appsavylogin: 'IG7gR27IJYSa+a/dym3wpw==',
  formid: 'TYDUFR2Pc592nssOkzMrLQ==',
  roleid: 'KnSKi2BRa296VND7xI1XWQ==',
  version: '1',
  token: 'Wwzpa2LygAJqAK1uM94i8A==',
  sourcetype: 'tzoukK4N1FBlaVGohFL/oQ==',
};

const requestXml = (district) =>
  '<?xml version="1.0"?><Request VERSION="2" LANGUAGE_ID="1" LOCATION="">' +
  '<Company Company_Id="93" /><Project Project_Id="304" /><User User_Id="Anonymous" />' +
  '<IUVLogin IUVLogin_Id="Anonymous" /><ROLE ROLE_ID="1595" /><Event Control_Id="130404" />' +
  '<Child Control_Id="125681" Report="HTML" AC_ID="163944">' +
  `<Parent Control_Id="130402" Value="${district}" Data_Form_Id="" XValue="${district}" YValue="" ZValue=""/>` +
  '</Child></Request>';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const tag = (row, name) => {
  const m = row.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};

async function session() {
  const r = await fetch(`${BASE}/ui/anonymous?PROJECTID=304&FORMID=11996`, { redirect: 'manual' });
  const cookies = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
  return cookies.join('; ');
}

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const district = parseInt(q.district || '10', 10);
  if (!(district >= 1 && district <= 12)) return res.status(400).json({ error: 'district must be 1-12' });
  const area = norm(q.area || 'sector21a');

  try {
    const cookie = await session();
    const r = await fetch(`${BASE}/api/AppsavyServices/GetRelationalDataA`, {
      method: 'POST',
      headers: { ...HEADERS, cookie },
      body: JSON.stringify({ inputxml: Buffer.from(requestXml(district)).toString('base64'), DocVersion: 1 }),
    });
    if (!r.ok) throw new Error(`DHBVN responded ${r.status}`);
    const xml = await r.text();
    const rows = (xml.match(/<Rowset>[\s\S]*?<\/Rowset>/g) || []).map((x) => ({
      feeder: tag(x, 'FEEDER'),
      area: tag(x, 'AREA'),
      start: tag(x, 'START_TIME'),
      restoration: tag(x, 'EXPECTED_RESTORATION_TIME'),
      address: tag(x, 'ADDRESS'),
      dt: tag(x, 'DT'),
    }));
    const matches = rows.filter((x) => norm(x.area).includes(area));
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    res.status(200).json({ district, area: q.area || 'sector21a', fetchedAt: new Date().toISOString(), totalRows: rows.length, matches });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
};
