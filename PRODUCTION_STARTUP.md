# Production Server Startup Guide

## 1. Connect to production server
ssh user@api.zhenwu.fun

## 2. Navigate to project directory
cd /path/to/nslg-battle

## 3. Start backend service
# Option A: Using PM2 (recommended for production)
pm2 start nslg-backend.js --name "nslg-backend"
pm2 save
pm2 startup

# Option B: Using nohup
nohup node nslg-backend.js > backend.log 2>&1 &

# Option C: Using systemd service
sudo systemctl start nslg-backend

## 4. Verify service is running
# Check if port 3000 is listening
netstat -tlnp | grep 3000
# OR
ss -tlnp | grep 3000

## 5. Check logs
# If using PM2
pm2 logs nslg-backend

# If using nohup
tail -f backend.log

# If using systemd
journalctl -u nslg-backend -f

## 6. Test local API
curl http://localhost:3000/api/projects?phone=13651810449

## 7. If Nginx configuration needs CORS fix
# Edit Nginx config
sudo nano /etc/nginx/sites-available/api.zhenwu.fun

# Add this inside server block:
location /api {
    # Handle CORS preflight
    if ($request_method = 'OPTIONS') {
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With" always;
        add_header Access-Control-Max-Age 86400 always;
        return 204;
    }

    # Proxy to Node.js backend
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # CORS headers for actual requests
    add_header Access-Control-Allow-Origin $http_origin always;
    add_header Access-Control-Allow-Credentials false always;
}

# Reload Nginx
sudo nginx -t
sudo systemctl reload nginx
