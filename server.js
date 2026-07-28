const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
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
    `별자리 특징: ${sign.trait}`,
    `별자리 분위기: ${sign.vibe}`,
    '',
    '아래 규칙을 지켜 로또 추천 결과를 만들어 주세요.',
    '- 한국 로또 기준으로 메인 번호 6개와 보너스 번호 1개를 추천하세요.',
    '- 모든 숫자는 1부터 45 사이 정수여야 합니다.',
    '- 메인 번호 6개는 중복 없이 오름차순으로 정렬하세요.',
    '- 보너스 번호는 메인 번호와 달라야 합니다.',
    '- 번호 선택의 이유를 3~5문장 한국어로 설명하세요.',
    '- 설명은 생년월일과 별자리의 성향을 어떻게 반영했는지 자연스럽게 풀어주세요.',
    '- 과도한 미신 표현은 피하고, 재미있는 연출은 허용합니다.',
    '- 반드시 JSON만 출력하세요.',
  ].join('\n');
}

function getApiKey(body) {
  return body.apiKey || process.env.OPENAI_API_KEY || '';
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
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            raw,
          });
        });
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
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }
  return '';
}

async function recommend(body) {
  const apiKey = getApiKey(body);
  const sign = normalizeSign(body.sign);

  if (!apiKey) {
    return { error: 'OpenAI API key가 없습니다.' };
  }
  if (!body.birthday || !sign) {
    return { error: '생년월일과 별자리가 필요합니다.' };
  }

  const requestBody = JSON.stringify({
    model: 'gpt-5.4-mini',
    input: [
      {
        role: 'system',
        content: '당신은 로또 번호 추천을 돕는 친절한 한국어 어시스턴트입니다. 결과는 정확한 JSON으로만 반환합니다.',
      },
      {
        role: 'user',
        content: buildPrompt(sign, body.birthday),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'lottery_recommendation',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            main: {
              type: 'array',
              minItems: 6,
              maxItems: 6,
              items: { type: 'integer', minimum: 1, maximum: 45 },
            },
            bonus: { type: 'integer', minimum: 1, maximum: 45 },
            explanation: { type: 'string' },
          },
          required: ['main', 'bonus', 'explanation'],
        },
      },
    },
  });

  const response = await openaiRequest(apiKey, requestBody);
  if (!response.ok) {
    return { error: `OpenAI API 오류(${response.status}): ${response.raw}` };
  }

  let data;
  try {
    data = JSON.parse(response.raw);
  } catch (error) {
    return { error: `OpenAI 응답 JSON 파싱 실패: ${response.raw}` };
  }

  const text = extractOutputText(data);
  if (!text) {
    return { error: 'OpenAI 응답에서 텍스트를 찾지 못했습니다.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `결과 JSON 파싱 실패: ${text}` };
  }

  const main = [...new Set((parsed.main || []).filter(Number.isInteger))].filter(n => n >= 1 && n <= 45).sort((a, b) => a - b);
  const bonus = Number.isInteger(parsed.bonus) && parsed.bonus >= 1 && parsed.bonus <= 45 ? parsed.bonus : null;
  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';

  if (main.length !== 6 || bonus === null || !explanation) {
    return { error: '응답 내용이 요구 형식과 맞지 않습니다.' };
  }
  if (main.includes(bonus)) {
    return { error: '보너스 번호가 메인 번호와 중복되었습니다.' };
  }

  return { main, bonus, explanation };
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }

  if (req.method === 'POST' && req.url === '/api/recommend') {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
    });
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');
        const result = await recommend(body);
        if (result.error) return send(res, 400, result);
        return send(res, 200, result);
      } catch (error) {
        return send(res, 500, { error: error.message });
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
