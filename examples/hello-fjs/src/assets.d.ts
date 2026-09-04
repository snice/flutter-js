// tsconfig 里 "types": []，拿不到 vite/client，所以静态资源导入的类型自己声明。
declare module '*.png' {
  const src: string;
  export default src;
}
