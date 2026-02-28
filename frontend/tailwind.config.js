/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontSize: {
        xs: ['14px', { lineHeight: '1.25rem' }],
      },
    },
  },
  plugins: [],
}
