import { render } from 'preact';
import { App } from './ui/App';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements { piece: { class?: string } }
  }
}

render(<App />, document.getElementById('root')!);
