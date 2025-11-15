import { render } from "hono/jsx/dom";

const App = () => <h1>Hello</h1>;

const domNode = document.querySelector<HTMLElement>("#root")!;
render(<App />, domNode);
