// 接口页的 Worker：300 万次开方求和。三端同一个文件——fjs build 把它打成
// /workers/sqrt.js（小程序在 miniprogram/workers/，外面包一层 wx worker 适配）。
// worker 里没有 fjs / vue 运行时，只有 onmessage / postMessage / console / 定时器。

// DOM lib 里的 postMessage 要两个参数；worker 的版本只收一条字符串消息
declare function postMessage(message: string): void;

onmessage = (e: MessageEvent) => {
  const n = Number(e.data);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.sqrt(i);
  postMessage(String(Math.round(sum)));
};
