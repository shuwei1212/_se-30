FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf
COPY proxy_headers.conf /etc/nginx/proxy_headers.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["wget", "-qO-", "http://127.0.0.1/nginx-health"]

CMD ["nginx", "-g", "daemon off;"]
