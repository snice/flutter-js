export interface FjsVitePlugin {
  name: string;
  enforce: 'pre';
}

export function fjs(): FjsVitePlugin;
