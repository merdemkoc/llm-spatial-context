import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['dist', '.context'] },
	js.configs.recommended,
	tseslint.configs.recommended,
	reactHooks.configs.flat['recommended-latest'],
	reactRefresh.configs.vite,
	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
	},
	// Must stay last: turns off rules that would fight Prettier.
	prettier
)
