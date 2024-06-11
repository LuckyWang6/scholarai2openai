const TELEGRAPH_URL = 'https://api.scholarai.io';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const headers_Origin = request.headers.get("Access-Control-Allow-Origin") || "*";

  // 修改路径为 /api/chat/completions
  url.host = TELEGRAPH_URL.replace(/^https?:\/\//, '');
  url.pathname = '/api/chat/completions';

  // 克隆请求以读取请求体
  const requestClone = request.clone();
  let requestBody = await requestClone.json();

  // 过滤掉 role 不是 'user' 的消息，保留最后一个
  if (requestBody.messages) {
    const userMessages = requestBody.messages.filter(message => message.role === 'user');
    if (userMessages.length > 0) {
      requestBody.messages = [userMessages.pop()];
    } else {
      // 如果没有用户消息，则清空消息列表
      requestBody.messages = [];
    }
  }

  // 在非流式数据中修改 model 字段
  requestBody.model = modifyModelAndIdInChunk(requestBody.model, requestBody.model, requestBody.id);

  // 修改请求中的 id 字段
  requestBody.id = GenerateCompletionId();

  const modifiedRequest = new Request(url.toString(), {
    headers: request.headers,
    method: request.method,
    body: JSON.stringify(requestBody), // 使用过滤后的请求体
    redirect: 'follow'
  });

  const response = await fetch(modifiedRequest);

  if (requestBody.stream === true) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let partialChunk = '';

    const processStream = async () => {
      let done, value;
      while ({ done, value } = await reader.read(), !done) {
        const chunk = decoder.decode(value, { stream: true });
        partialChunk += chunk;

        let lines = partialChunk.split('\n');
        partialChunk = lines.pop();  // Keep the last incomplete line for the next read

        for (const line of lines) {
          const modifiedLine = modifyModelAndIdInChunk(line, requestBody.model, requestBody.id);
          await writer.write(encoder.encode(`data: ${modifiedLine}\n\n`));
        }
      }
      if (partialChunk) {
        const modifiedChunk = modifyModelAndIdInChunk(partialChunk, requestBody.model, requestBody.id);
        await writer.write(encoder.encode(`data: ${modifiedChunk}\n\n`));
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      writer.close();
    };

    processStream().catch(err => console.error('Stream processing error:', err));

    const modifiedResponse = new Response(readable, response);
    modifiedResponse.headers.set('Access-Control-Allow-Origin', headers_Origin);
    return modifiedResponse;
  } else {
    // 在非流式响应中修改 model 字段
    let modifiedBody;
    try {
      modifiedBody = await response.json();
      modifiedBody.model = requestBody.model;
      modifiedBody.id = GenerateCompletionId(); // 修改返回的 id 字段
    } catch (error) {
      console.error('Error parsing JSON response:', error);
      modifiedBody = await response.text();
    }
    const modifiedResponse = new Response(JSON.stringify(modifiedBody), response);
    modifiedResponse.headers.set('Access-Control-Allow-Origin', headers_Origin);
    return modifiedResponse;
  }
}

function modifyModelAndIdInChunk(chunk, model, id) {
  try {
    const json = JSON.parse(chunk);
    json.model = model;
    json.id = id;
    return JSON.stringify(json);
  } catch (error) {
    return chunk;
  }
}

function GenerateCompletionId(prefix = "chatcmpl-") {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const length = 28;

  let id = prefix;
  for (let i = 0; i < length; i++) {
    id += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return id;
}
