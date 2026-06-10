/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#f7f7f8',
        brand: {
          DEFAULT: '#4d6bfe',
          light: '#eef2ff',
          hover: '#3d5bd9',
        },
      },
      maxWidth: {
        chat: '800px',
      },
    },
  },
  plugins: [],
}
