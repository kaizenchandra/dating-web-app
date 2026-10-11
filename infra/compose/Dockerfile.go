FROM golang:1.25-bookworm AS build
ARG SERVICE
WORKDIR /src
COPY services/${SERVICE}/ ./
RUN go mod download && CGO_ENABLED=0 go build -o /service .
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /service /service
ENTRYPOINT ["/service"]
