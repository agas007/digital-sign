import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 20px 60px -20px rgba(15, 23, 42, 0.25)"
      },
      colors: {
        ink: {
          950: "#09111f"
        }
      }
    }
  },
  plugins: []
};

export default config;
