import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	root: 'web',
	build: { outDir: 'dist', emptyOutDir: true },
	server: {
		port: 5175,
		proxy: { '/api': 'http://localhost:5174' },
		// shared/ lives above the Vite root, so it must be explicitly allowed.
		fs: { allow: ['..'] },
	},
});
