FROM rust:1.88-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Create dummy main for dependency caching
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src/

COPY src/ src/
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/storm-gateway /usr/local/bin/
EXPOSE 3001
CMD ["storm-gateway"]
