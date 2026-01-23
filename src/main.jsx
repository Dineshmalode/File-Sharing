import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

import { Amplify } from "aws-amplify";
import awsconfig from "./aws-exports.js";

Amplify.configure(awsconfig, { ssr: false });

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
