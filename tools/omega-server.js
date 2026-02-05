const http = require("http");
const { execSync } = require("child_process");

const PORT = 7749;

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method === "POST" && req.url === "/exec") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const { command } = JSON.parse(body);
                const result = execSync(
                    `/Users/yay/workspace/genspark-agent/tools/omega-runner-noconfirm.sh ${JSON.stringify(command)}`,
                    { encoding: "utf8", timeout: 30000 }
                );
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, result }));
            } catch (e) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(PORT, () => {
    console.log(`Omega Server running on http://localhost:${PORT}`);
});
