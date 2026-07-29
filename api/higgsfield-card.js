function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(body));
}

function buildPrompt(sign, birthday, numbers) {
  return [
    'Create a premium celestial zodiac card illustration.',
    'Style: deep navy space background, glowing constellation stars, elegant, clean, magical, and cinematic.',
    'Use connected dots, delicate constellations, soft star halos, and a refined card composition.',
    `Zodiac sign: ${sign.name}`,
    `Birthday seed: ${birthday}`,
    `Lottery numbers: ${numbers.main.join(', ')} + bonus ${numbers.bonus}`,
    'No text, no watermark, no extra border, highly detailed, luminous, polished, and balanced.',
  ].join(' ');
}

function getZodiac(dateStr) {
  const signs = [
    { name: '양자리', start: '03-21', end: '04-19' },
    { name: '황소자리', start: '04-20', end: '05-20' },
    { name: '쌍둥이자리', start: '05-21', end: '06-21' },
    { name: '게자리', start: '06-22', end: '07-22' },
    { name: '사자자리', start: '07-23', end: '08-22' },
    { name: '처녀자리', start: '08-23', end: '09-22' },
    { name: '천칭자리', start: '09-23', end: '10-22' },
    { name: '전갈자리', start: '10-23', end: '11-22' },
    { name: '사수자리', start: '11-23', end: '12-21' },
    { name: '염소자리', start: '12-22', end: '01-19' },
    { name: '물병자리', start: '01-20', end: '02-18' },
    { name: '물고기자리', start: '02-19', end: '03-20' },
  ];
  const [, mm, dd] = String(dateStr || '').split('-');
  const key = `${mm}-${dd}`;
  return signs.find(sign => sign.start <= sign.end ? key >= sign.start && key <= sign.end : key >= sign.start || key <= sign.end) || null;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return send(res, 400, { error: '잘못된 JSON 요청입니다.' });
  }

  const credentials = String(payload.credentials || '').trim();
  const sign = getZodiac(payload.birthday);
  if (!credentials) return send(res, 400, { error: 'Higgsfield credentials가 필요합니다.' });
  if (!payload.birthday || !sign) return send(res, 400, { error: '별자리 계산용 생년월일이 필요합니다.' });
  if (!payload.numbers?.main?.length || typeof payload.numbers.bonus === 'undefined') {
    return send(res, 400, { error: '추천 번호가 필요합니다.' });
  }

  try {
    const { HiggsfieldClient } = require('@higgsfield/client');
    const helpers = require('@higgsfield/client/helpers');
    const [apiKey, apiSecret] = credentials.split(':');

    const client = new HiggsfieldClient({
      apiKey: apiKey || '',
      apiSecret: apiSecret || '',
    });

    const jobSet = await client.generate('/v1/text2image/soul', {
      prompt: buildPrompt(sign, payload.birthday, payload.numbers),
      width_and_height: helpers.SoulSize.SQUARE_1536x1536,
      quality: helpers.SoulQuality.HD,
      batch_size: helpers.BatchSize.SINGLE,
    }, {
      withPolling: true,
    });

    const imageUrl = jobSet?.jobs?.[0]?.results?.raw?.url || jobSet?.jobs?.[0]?.results?.min?.url;
    if (!imageUrl) {
      return send(res, 502, { error: '이미지 URL을 찾지 못했습니다.' });
    }

    return send(res, 200, {
      imageUrl,
      requestId: jobSet.id || jobSet.requestId || null,
      status: jobSet.isCompleted ? 'completed' : 'unknown',
    });
  } catch (error) {
    return send(res, 502, {
      error: error?.message || 'Higgsfield 요청 실패',
    });
  }
};
