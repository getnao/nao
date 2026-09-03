{{/*
Expand the name of the chart.
*/}}
{{- define "nao.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this.
*/}}
{{- define "nao.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "nao.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "nao.labels" -}}
helm.sh/chart: {{ include "nao.chart" . }}
{{ include "nao.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Common annotations — applied at metadata.annotations on top-level objects
(Deployment, StatefulSet, etc.), as required by org-wide admission policies.
*/}}
{{- define "nao.annotations" -}}
{{- with .Values.commonAnnotations }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "nao.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nao.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name
*/}}
{{- define "nao.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "nao.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Full image reference (repository:tag)
*/}}
{{- define "nao.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end }}

{{/*
PostgreSQL host — uses the bitnami subchart service name when postgresql.enabled=true,
otherwise falls back to a user-supplied host embedded in secrets.dbUri.
*/}}
{{- define "nao.postgresqlHost" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "%s-postgresql" (include "nao.fullname" .) -}}
{{- end -}}
{{- end }}
{{/*
Build the DB_URI from subchart values when postgresql.enabled=true.
Does not support auth.existingSecret — when using existingSecret,
set secrets.dbUri manually with the full connection string.
*/}}
{{- define "nao.dbUri" -}}
{{- if .Values.postgresql.enabled -}}
{{- if not .Values.postgresql.auth.existingSecret }}
{{- printf "postgres://%s:%s@%s:5432/%s"
    .Values.postgresql.auth.username
    .Values.postgresql.auth.password
    (include "nao.postgresqlHost" .)
    .Values.postgresql.auth.database -}}
{{- else }}
{{- .Values.secrets.dbUri }}
{{- end }}
{{- else -}}
{{- .Values.secrets.dbUri -}}
{{- end -}}
{{- end }}
{{/*
Name of the Secret the pod loads env vars from: the chart-rendered Secret,
or a pre-existing one when existingSecret is set.
*/}}
{{- define "nao.secretName" -}}
{{- default (include "nao.fullname" .) .Values.existingSecret -}}
{{- end }}
