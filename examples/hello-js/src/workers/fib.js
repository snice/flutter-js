// gallery 的 Worker 演示：按收到的轮数算斐波那契，回一条字符串。
onmessage = function (e) {
  var rounds = parseInt(e.data, 10) || 5;
  var a = 1, b = 1;
  for (var i = 0; i < rounds; i++) { var t = a + b; a = b; b = t; }
  postMessage('fib step -> ' + a);
};
