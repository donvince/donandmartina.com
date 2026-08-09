# frozen_string_literal: true

require 'yaml'

root = File.expand_path('../..', __dir__)
%w[infra/template.yaml infra/cognito.yaml].each do |relative|
  path = File.join(root, relative)
  source = File.read(path).gsub(/!(?:Sub|Ref|GetAtt)\s+/, '')
  template = YAML.safe_load(source, permitted_classes: [], aliases: false)

  template.fetch('Resources', {}).each do |logical_id, resource|
    next unless resource['Type'] == 'AWS::IAM::Role'

    boundary = resource.fetch('Properties', {})['PermissionsBoundary']
    next if boundary.to_s.include?('ProjectWorkloadBoundary')

    warn "#{relative}: runtime role #{logical_id} lacks ProjectWorkloadBoundary"
    exit 1
  end
end
