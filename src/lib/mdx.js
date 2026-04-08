import * as runtime from 'react/jsx-runtime';
import { evaluate } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';

export async function compileMdxToComponent(source) {
  const evaluated = await evaluate(source || '', {
    ...runtime,
    remarkPlugins: [remarkGfm],
    useDynamicImport: false,
    development: false,
  });
  return evaluated.default;
}
