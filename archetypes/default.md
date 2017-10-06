---
title: "{{ .TranslationBaseName | replaceRE "\\d{4}-\\d{2}-\\d{2}_" "" | replaceRE "[-_]" " " | title }}"
description: "Honeymoon Day #"
date: "{{ .TranslationBaseName | findRE "\\d{4}-\\d{2}-\\d{2}" }}T00:00:00+01:00"
draft: true
---
