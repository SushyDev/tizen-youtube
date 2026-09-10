# The built Cobalt, and what running it needs.
#
# Built by .github/workflows/cobalt-image.yaml, whose context is the youtube/cobalt checkout and
# whose stage/ holds the binary, its content directory and any shared object beside it.
#
# On Cobalt's own unittest runtime, which is the image their Linux tests run in and so carries the
# libraries a linux-x64x11 build links against. The packages below are its runtime counterparts
# again, because a missing one fails at launch with nothing in the log but a loader error.

FROM ghcr.io/youtube/cobalt/cobalt-linux-x64x11-unittest:25.lts

RUN apt-get update -qqy \
    && apt-get install -qqy --no-install-recommends \
        xvfb xauth \
        libegl1 libgles2 libx11-6 libxcomposite1 libxi6 libxrender1 \
        libasound2 libpulse0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The Linux port looks for its content at <binary directory>/content, so the two stay together.
COPY stage /cobalt

ENV DISPLAY=:99

# Cobalt's own Xvfb invocation from docker/linux/xvfb, since a runner has no display for a port
# that expects to draw on one.
ENTRYPOINT ["/bin/sh", "-c", "Xvfb -ac -listen tcp :99 -noreset +extension GLX +render -screen 0 1920x1080x24 >/dev/null 2>&1 & exec \"$@\"", "--"]
CMD ["/cobalt/cobalt"]
