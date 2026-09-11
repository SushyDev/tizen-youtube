FROM ghcr.io/youtube/cobalt/cobalt-linux-x64x11-unittest:25.lts@sha256:3f59ed4ff458daef063f696bbb311db42564bec81ea6d6d41a6d8f8249902fed

RUN apt-get update -qqy \
    && apt-get install -qqy --no-install-recommends \
        xvfb xauth \
        libegl1 libgles2 libx11-6 libxcomposite1 libxi6 libxrender1 \
        libasound2 libpulse0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The Linux port looks for its content at <binary directory>/content, so the two stay together.
COPY stage /cobalt

ENV DISPLAY=:99

ENTRYPOINT ["/bin/sh", "-c", "Xvfb -ac -listen tcp :99 -noreset +extension GLX +render -screen 0 1920x1080x24 >/dev/null 2>&1 & exec \"$@\"", "--"]
CMD ["/cobalt/cobalt"]
