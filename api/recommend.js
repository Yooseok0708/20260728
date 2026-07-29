const https = require('https');

function send(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(body));
}

function normalizeSign(sign) {
  if (!sign || typeof sign !== 'object') return null;
  return {
    name: String(sign.name || '').trim(),
    element: String(sign.element || '').trim(),
    trait: String(sign.trait || '').trim(),
    vibe: String(sign.vibe || '').trim(),
  };
}

function buildPrompt(sign, birthday) {
  return [
    `생년월일: ${birthday}`,
    `별자리: ${sign.name}`,
    `별자리 요소: ${sign.element}`,
    `별자리 성향: ${sign.trait}`,
    `별자리 분위기: ${sign.vibe}`,
    '',
    '아래 규칙을 지켜 로또 추천 결과를 만들어 주세요.',
    '- 한국 로또 기준으로 메인 번호 6개와 보너스 번호 1개를 추천하세요.',
    '- 모든 숫자는 1부터 45 사이의 정수여야 합니다.',
    '- 메인 번호 6개는 중복 없이 오름차순으로 정렬하세요.',
    '- 보너스 번호는 메인 번호와 달라야 합니다.',
    '- 번호 선택의 이유를 3~5문장 한국어로 설명하세요.',
    '- 반드시 JSON만 출력하세요.',
  ].join('\n');
}

function openaiRequest(apiKey, requestBody) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, raw }));
      }
    );
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
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

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const sign = normalizeSign(payload.sign);
  if (!apiKey) return send(res, 400, { error: 'OPENAI_API_KEY 환경변수가 필요합니다.' });
  if (!payload.birthday || !sign) return send(res, 400, { error: '생년월일과 별자리가 필요합니다.' });

  const requestBody = JSON.stringify({
    model: 'gpt-5.4-mini',
    input: [
      { role: 'system', content: '당신은 로또 번호 추천을 돕는 친절한 한국어 챗봇입니다. 결과는 정확한 JSON만 반환합니다.' },
      { role: 'user', content: buildPrompt(sign, payload.birthday) },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'lottery_recommendation',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            main: { type: 'array', minItems: 6, maxItems: 6, items: { type: 'integer', minimum: 1, maximum: 45 } },
            bonus: { type: 'integer', minimum: 1, maximum: 45 },
            explanation: { type: 'string' },
          },
          required: ['main', 'bonus', 'explanation'],
        },
      },
    },
  });

  const response = await openaiRequest(apiKey, requestBody);
  if (!response.ok) return send(res, 502, { error: `OpenAI API 오류(${response.status}).` });

  let data;
  try {
    data = JSON.parse(response.raw);
  } catch {
    return send(res, 502, { error: 'OpenAI 응답 JSON 파싱 실패' });
  }

  const text = extractOutputText(data);
  if (!text) return send(res, 502, { error: 'OpenAI 응답에서 텍스트를 찾지 못했습니다.' });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return send(res, 502, { error: '결과 JSON 파싱 실패' });
  }

  const main = [...new Set((parsed.main || []).filter(Number.isInteger))].filter(n => n >= 1 && n <= 45).sort((a, b) => a - b);
  const bonus = Number.isInteger(parsed.bonus) && parsed.bonus >= 1 && parsed.bonus <= 45 ? parsed.bonus : null;
  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';

  if (main.length !== 6 || bonus === null || !explanation) return send(res, 502, { error: '응답 형식이 올바르지 않습니다.' });
  if (main.includes(bonus)) return send(res, 502, { error: '보너스 번호가 메인 번호와 중복되었습니다.' });

  return send(res, 200, { main, bonus, explanation });
};
