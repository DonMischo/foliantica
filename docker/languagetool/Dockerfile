# LanguageTool with native hunspell for arm64.
#
# meyay/languagetool is multi-arch, but LanguageTool only bundles precompiled
# hunspell natives for x86_64 — on arm64 the German (and other hunspell-based)
# spellcheckers fail with "Error loading shared library libhunspell.so".
# Install Alpine's hunspell and provide the unversioned .so name the JNA
# binding loads. Harmless no-op duplication on amd64.
FROM meyay/languagetool:latest

USER root
RUN apk add --no-cache hunspell && \
    ln -sf /usr/lib/libhunspell-1.7.so.0 /usr/lib/libhunspell.so
# The base image's entrypoint drops privileges itself (no USER directive).
