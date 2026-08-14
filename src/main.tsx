import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
// The loaders' own stylesheet, imported once here rather than in each component that uses
// one: the package marks its CSS as a side effect, so a single import is enough and the
// app keeps one place where styles enter.
import 'generative-loaders/styles.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
)
