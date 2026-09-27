## Project background

Site de agendamento da Barbearia Emanuel Sousa para clientes que desejam reservar, consultar e cancelar horários pelo celular. O objetivo é reduzir contatos manuais e dar ao cliente um comprovante claro de cada alteração.

## Product shape

- Página dinâmica em português do Brasil, com estética editorial inspirada na identidade original em vermelho, azul e grafite.
- Fluxo público de agendamento em etapas: serviço, data, horário, contato e confirmação.
- Persistência server-side em banco Supabase compatível; nenhum agendamento depende de localStorage.
- Consulta de contato e histórico pelo número completo de celular, com cancelamento de horários futuros.
- Confirmações e cancelamentos geram um registro de notificação e uma mensagem pronta para compartilhamento no WhatsApp.
- O envio automático pela API oficial do WhatsApp não faz parte deste artefato porque exigiria credenciais secretas de provedor não disponíveis no runtime da Page.
- Não há login administrativo nem edição pública de serviços nesta versão.
