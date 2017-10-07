---
title: "{{ .TranslationBaseName | replaceRE "\\d{4}-\\d{2}-\\d{2}_" "" | replaceRE "[-_]" " " | title }}"
description: "{{ .TranslationBaseName }}"
date: {{ index (findRE "\\d{4}-\\d{2}-\\d{2}" .TranslationBaseName 1) 0 | time }}
draft: true
---
