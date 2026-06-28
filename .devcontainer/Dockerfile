FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Tell playwright npm package to skip browser downloads —
# the base image already has Chromium, Firefox, and WebKit at /ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN mkdir -p /workspace && chown pwuser:pwuser /workspace

WORKDIR /workspace
