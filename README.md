# Hashi

## 🚀 Usage

```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

## Credits

This project is based on [ctt](https://github.com/iawooo/ctt)'s awesome work. Thanks [iawooo](https://github.com/iawooo)！

## 📝 License

[MIT](./LICENSE). Made with ❤️ by [Ray](https://github.com/so1ve)
