# The site and its downloads as a static server (scripts/site-deploy.sh builds the context).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY www/ /usr/share/nginx/html/
