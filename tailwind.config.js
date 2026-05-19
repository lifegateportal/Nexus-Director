/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        shell: {
          950: "#0b1220",
          900: "#121d33",
          800: "#1d2a45"
        },
        accent: {
          500: "#00b8d9",
          400: "#39c9e4"
        }
      },
      boxShadow: {
        panel: "0 10px 30px rgba(0, 0, 0, 0.25)",
        glow: "0 0 20px rgba(0, 184, 217, 0.25)",
        "glow-emerald": "0 0 8px rgba(52, 211, 153, 0.6)",
        "glow-cyan": "0 0 8px rgba(0, 184, 217, 0.8)"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "scan-line": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.25s ease-out both",
        "scan-line": "scan-line 2s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
