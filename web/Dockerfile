FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json .
RUN bun install
COPY . .
RUN bun build ts/main.ts --outdir dist/ --minify

FROM nginx:alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/dist/
COPY --from=build /app/css/ /usr/share/nginx/html/css/
COPY --from=build /app/index.html /usr/share/nginx/html/
COPY --from=build /app/assets/ /usr/share/nginx/html/assets/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
